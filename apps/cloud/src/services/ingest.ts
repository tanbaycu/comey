import {
  applyTransactionToSession,
  decryptSecret,
  evaluateRoutingRules,
  formatDiscordWebhookPayload,
  formatGoogleSheetsRowPayload,
  formatPayOSWebhookPayload,
  formatSePayWebhookPayload,
  formatTelegramMessagePayload,
  matchesOrderCode,
  processIncomingEmail,
  randomHex,
  type EmailAuthResult,
  type GmailForwardingConfirmation,
  type RawEmailInput,
  type UnifiedTransaction,
} from '@comey/core';
import {
  rowToPaymentSession,
  rowToRoutingRule,
  type BankAccountRow,
  type PaymentSessionRow,
  type RoutingRuleRow,
} from '../db/types.js';
import type { Env } from '../env.js';
import { isSandboxWebhookUrl, parseTelegramChatId } from '../security/urlGuard.js';
import {
  createAndScheduleDelivery,
  type DeliveryAttemptResult,
} from './webhookDelivery.js';

export type IngestResult =
  | {
      status: 'forwarding_confirmation';
      confirmation: GmailForwardingConfirmation;
    }
  | {
      status: 'ignored';
      reason: string;
    }
  | {
      status: 'quarantined';
      quarantineId: string;
      reason: string;
      auth: EmailAuthResult;
    }
  | {
      status: 'duplicate';
      transactionId: string;
    }
  | {
      status: 'parsed';
      transaction: UnifiedTransaction;
      matchedOrderCode: string | null;
      sessionAction: string | null;
      sessionId: string | null;
      deliveries: DeliveryAttemptResult[];
    };

function buildSafeSnippet(email: RawEmailInput): string {
  const sourceText = email.textBody || email.htmlBody || email.rawMime || '';
  return sourceText.replace(/\s+/g, ' ').trim().slice(0, 16_384);
}

export interface IngestOptions {
  syncWebhooks?: boolean;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  /**
   * When true (Dashboard owner simulator), simulated transactions may also match live (is_test = 0) sessions.
   * NEVER set true for cm_test_ API keys (CRIT-3).
   */
  allowLiveSessionMatch?: boolean;
  /**
   * When true (cm_test_ API keys), ONLY dispatch webhooks targeting internal://sandbox-inbox (CRIT-3).
   */
  sandboxWebhooksOnly?: boolean;
  /**
   * When true, allow simulated transactions to fire external non-sandbox SePay/PayOS webhooks
   * (default false because SePay/PayOS wire formats carry no isTest flag).
   */
  allowExternalCompatWebhooks?: boolean;
}

export async function ingestRawEmailForAccount(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'> | undefined,
  account: BankAccountRow,
  rawEmail: RawEmailInput,
  options?: IngestOptions
): Promise<IngestResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const processed = await processIncomingEmail(rawEmail, {
    expectedAccountNo: account.account_number,
    strictAuth: account.strict_auth === 1,
  });

  if (processed.outcome === 'forwarding_confirmation') {
    await env.DB.prepare(
      `UPDATE bank_accounts
       SET forwarding_status = 'confirmation_received',
           forwarding_confirm_code = ?,
           forwarding_confirm_url = ?,
           forwarding_requester_email = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        processed.confirmation.confirmationCode ?? null,
        processed.confirmation.confirmationUrl ?? null,
        processed.confirmation.requesterEmail ?? null,
        nowIso,
        account.id
      )
      .run();

    return {
      status: 'forwarding_confirmation',
      confirmation: processed.confirmation,
    };
  }

  if (processed.outcome === 'ignored') {
    return {
      status: 'ignored',
      reason: processed.reason,
    };
  }

  if (processed.outcome === 'quarantined') {
    const quarantineId = `q_${randomHex(12)}`;
    const expiresAt = new Date(nowMs + 72 * 3600 * 1000).toISOString();
    const senderForLog =
      rawEmail.from || processed.auth.headerFrom || rawEmail.envelopeFrom || '';
    await env.DB.prepare(
      `INSERT INTO quarantine_emails (
        id, workspace_id, bank_account_id, source, bank_code, sender, subject,
        reason, auth_status, auth_json, raw_hash, raw_snippet, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', ?, ?)`
    )
      .bind(
        quarantineId,
        account.workspace_id,
        account.id,
        rawEmail.source,
        processed.bankCode ?? null,
        senderForLog,
        rawEmail.subject ?? null,
        processed.reason,
        processed.auth.status,
        JSON.stringify(processed.auth),
        processed.rawHash,
        buildSafeSnippet(rawEmail),
        expiresAt,
        nowIso
      )
      .run();

    return {
      status: 'quarantined',
      quarantineId,
      reason: processed.reason,
      auth: processed.auth,
    };
  }

  const tx = processed.transaction;
  const txRecordId = `tx_${randomHex(12)}`;
  const idempotencyKey = tx.id;
  // CRIT-3: Tag cm_test_ sandbox simulator transactions distinctly so live Soundboxes never announce them
  const storedSource =
    tx.isTest && options?.sandboxWebhooksOnly ? 'simulator_sandbox' : tx.source;

  // Insert transaction atomically with UNIQUE(bank_account_id, idempotency_key)
  try {
    await env.DB.prepare(
      `INSERT INTO transactions (
        id, workspace_id, bank_account_id, idempotency_key,
        bank_code, bank_bin, bank_tx_id, account_number, direction, amount, currency,
        content, occurred_at, sender_name, sender_bank, source, email_message_id,
        raw_hash, auth_status, auth_dkim_domain, is_test, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        txRecordId,
        account.workspace_id,
        account.id,
        idempotencyKey,
        tx.bankCode,
        tx.bankBin,
        tx.txId,
        tx.accountNumber,
        tx.direction,
        tx.amount,
        tx.currency,
        tx.content,
        tx.occurredAt,
        tx.senderName ?? null,
        tx.senderBank ?? null,
        storedSource,
        tx.emailMessageId ?? null,
        tx.rawHash,
        tx.auth.status,
        tx.auth.dkimDomain ?? null,
        tx.isTest ? 1 : 0,
        nowIso
      )
      .run();
  } catch (err) {
    const existing = await env.DB.prepare(
      `SELECT id FROM transactions WHERE bank_account_id = ? AND idempotency_key = ?`
    )
      .bind(account.id, idempotencyKey)
      .first<{ id: string }>();
    if (existing) {
      return { status: 'duplicate', transactionId: existing.id };
    }
    throw err;
  }

  // Layer 1 & Layer 2 parallel fetch (PERF-M3 & HIGH-5 & CRIT-3)
  const lookbackIso = new Date(nowMs - 48 * 3600 * 1000).toISOString();
  const sessionIsolationClause = tx.isTest
    ? options?.allowLiveSessionMatch
      ? ''
      : ' AND is_test = 1'
    : ' AND is_test = 0';

  const [activeSessions, ruleRows] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM payment_sessions
       WHERE bank_account_id = ? AND status IN ('pending', 'underpaid') AND created_at >= ?${sessionIsolationClause}
       ORDER BY created_at DESC
       LIMIT 100`
    )
      .bind(account.id, lookbackIso)
      .all<PaymentSessionRow>(),
    env.DB.prepare(
      `SELECT * FROM routing_rules
       WHERE bank_account_id = ? AND enabled = 1
       ORDER BY priority ASC`
    )
      .bind(account.id)
      .all<RoutingRuleRow>(),
  ]);

  let matchedSessionRow: PaymentSessionRow | null = null;
  for (const row of activeSessions.results) {
    if (matchesOrderCode(tx.content, row.order_code)) {
      matchedSessionRow = row;
      break;
    }
  }

  // Targeted fallback check for recently expired/cancelled sessions only when no active session matched
  // so late_payment detection continues to work cleanly without scanning all historical sessions.
  if (!matchedSessionRow) {
    const closedSessions = await env.DB.prepare(
      `SELECT * FROM payment_sessions
       WHERE bank_account_id = ? AND status IN ('expired', 'cancelled') AND created_at >= ?${sessionIsolationClause}
       ORDER BY created_at DESC
       LIMIT 50`
    )
      .bind(account.id, lookbackIso)
      .all<PaymentSessionRow>();

    for (const row of closedSessions.results) {
      if (matchesOrderCode(tx.content, row.order_code)) {
        matchedSessionRow = row;
        break;
      }
    }
  }

  let matchedOrderCode: string | null = null;
  let sessionAction: string | null = null;
  let sessionId: string | null = null;
  let sessionEvent:
    | {
        eventType:
          | 'session.paid'
          | 'session.underpaid'
          | 'session.overpaid_review'
          | 'session.late_payment';
        session: ReturnType<typeof rowToPaymentSession>;
      }
    | null = null;

  if (matchedSessionRow) {
    const coreSession = rowToPaymentSession(matchedSessionRow);
    const applied = applyTransactionToSession(coreSession, tx, nowMs);

    if (
      applied.action === 'paid' ||
      applied.action === 'underpaid' ||
      applied.action === 'overpaid_review' ||
      applied.action === 'late_payment'
    ) {
      const updateRes = await env.DB.prepare(
        `UPDATE payment_sessions
         SET status = ?,
             received_amount = ?,
             overpaid = ?,
             excess_amount = ?,
             missing_amount = ?,
             matched_tx_id = ?,
             paid_at = ?,
             updated_at = ?
         WHERE id = ? AND status = ?`
      )
        .bind(
          applied.session.status,
          applied.session.receivedAmount,
          applied.session.overpaid ? 1 : 0,
          applied.session.excessAmount,
          applied.session.missingAmount,
          applied.session.matchedTxId ?? null,
          applied.session.paidAt ?? null,
          applied.session.updatedAt,
          matchedSessionRow.id,
          matchedSessionRow.status
        )
        .run();

      if ((updateRes.meta?.changes ?? 0) > 0) {
        matchedOrderCode = matchedSessionRow.order_code;
        sessionAction = applied.action;
        sessionId = matchedSessionRow.id;
        sessionEvent = {
          eventType: applied.eventType,
          session: {
            ...applied.session,
            bankAccountId: matchedSessionRow.bank_account_id,
            isTest: matchedSessionRow.is_test === 1,
          },
        };
      }
    }
  }

  const coreRules = ruleRows.results.map(rowToRoutingRule);
  const routeMatches = evaluateRoutingRules(tx.content, coreRules);

  if (!matchedOrderCode && routeMatches[0]?.extractedCode) {
    matchedOrderCode = routeMatches[0].extractedCode;
  }

  // PERF-H4: Store uppercase matched_order_code so queries use idx_transactions_ws_order_created directly
  if (matchedOrderCode) {
    matchedOrderCode = matchedOrderCode.trim().toUpperCase();
  }

  if (matchedOrderCode || sessionId) {
    await env.DB.prepare(
      `UPDATE transactions
       SET matched_order_code = ?, matched_session_id = ?
       WHERE id = ?`
    )
      .bind(matchedOrderCode, sessionId, txRecordId)
      .run();
  }

  const deliveries: DeliveryAttemptResult[] = [];
  const scheduledKeys = new Set<string>();
  const ruleRowById = new Map(ruleRows.results.map((r) => [r.id, r]));

  const storedTx: UnifiedTransaction = { ...tx, id: txRecordId };

  // Dispatch transaction.received to matched routing rules
  for (const match of routeMatches) {
    const ruleRow = ruleRowById.get(match.rule.id);
    if (!ruleRow) continue;
    const payloadFormat = ruleRow.payload_format ?? 'comey';
    const isSandboxTarget = isSandboxWebhookUrl(ruleRow.webhook_url);

    // CRIT-3: Sandbox API keys ONLY dispatch to internal://sandbox-inbox
    if (options?.sandboxWebhooksOnly && !isSandboxTarget) {
      continue;
    }

    // CRIT-3: Simulated transfers do NOT fire external SePay/PayOS webhooks unless explicitly opted-in
    if (
      tx.isTest &&
      !isSandboxTarget &&
      (payloadFormat === 'sepay' || payloadFormat === 'payos') &&
      !options?.allowExternalCompatWebhooks
    ) {
      continue;
    }

    const dedupeKey = `transaction.received::${payloadFormat}::${ruleRow.webhook_url}`;
    if (scheduledKeys.has(dedupeKey)) continue;
    scheduledKeys.add(dedupeKey);

    let preformattedPayloadJson: string | undefined;
    if (payloadFormat === 'sepay') {
      preformattedPayloadJson = JSON.stringify(formatSePayWebhookPayload(storedTx));
    } else if (payloadFormat === 'payos') {
      const secret = await decryptSecret(ruleRow.webhook_secret_enc, env.MASTER_ENCRYPTION_KEY);
      preformattedPayloadJson = JSON.stringify(
        await formatPayOSWebhookPayload(storedTx, secret)
      );
    } else if (payloadFormat === 'telegram') {
      const chatId = parseTelegramChatId(ruleRow.webhook_url) ?? 'sandbox';
      preformattedPayloadJson = JSON.stringify(
        formatTelegramMessagePayload(storedTx, chatId)
      );
    } else if (payloadFormat === 'discord') {
      preformattedPayloadJson = JSON.stringify(formatDiscordWebhookPayload(storedTx));
    } else if (payloadFormat === 'google_sheets') {
      const secret = await decryptSecret(ruleRow.webhook_secret_enc, env.MASTER_ENCRYPTION_KEY);
      preformattedPayloadJson = JSON.stringify(
        formatGoogleSheetsRowPayload(storedTx, secret)
      );
    }

    const dlv = await createAndScheduleDelivery(
      env,
      ctx,
      {
        workspaceId: account.workspace_id,
        eventType: 'transaction.received',
        targetUrl: ruleRow.webhook_url,
        webhookSecretEnc: ruleRow.webhook_secret_enc,
        payloadFormat,
        preformattedPayloadJson,
        isTest: tx.isTest,
        transactionId: txRecordId,
        sessionId: sessionId ?? undefined,
        routingRuleId: ruleRow.id,
        data: {
          transaction: storedTx,
          matchedOrderCode: match.extractedCode ?? matchedOrderCode,
          ruleName: ruleRow.name,
        },
      },
      {
        sync: options?.syncWebhooks,
        fetchImpl: options?.fetchImpl,
        nowMs,
      }
    );
    deliveries.push(dlv);
  }

  // Dispatch session event to session webhookUrl and/or matched Comey-format rules
  // (SePay/PayOS drop-in rules receive one webhook per incoming transaction in Layer 1)
  if (sessionEvent && matchedSessionRow) {
    const targets: Array<{
      url: string;
      secretEnc: string;
      routingRuleId?: string;
    }> = [];

    if (matchedSessionRow.webhook_url && matchedSessionRow.webhook_secret_enc) {
      targets.push({
        url: matchedSessionRow.webhook_url,
        secretEnc: matchedSessionRow.webhook_secret_enc,
      });
    }

    for (const match of routeMatches) {
      const ruleRow = ruleRowById.get(match.rule.id);
      if (ruleRow && (ruleRow.payload_format ?? 'comey') === 'comey') {
        targets.push({
          url: ruleRow.webhook_url,
          secretEnc: ruleRow.webhook_secret_enc,
          routingRuleId: ruleRow.id,
        });
      }
    }

    for (const target of targets) {
      if (options?.sandboxWebhooksOnly && !isSandboxWebhookUrl(target.url)) {
        continue;
      }

      const dedupeKey = `${sessionEvent.eventType}::${target.url}`;
      if (scheduledKeys.has(dedupeKey)) continue;
      scheduledKeys.add(dedupeKey);

      const dlv = await createAndScheduleDelivery(
        env,
        ctx,
        {
          workspaceId: account.workspace_id,
          eventType: sessionEvent.eventType,
          targetUrl: target.url,
          webhookSecretEnc: target.secretEnc,
          isTest: tx.isTest,
          transactionId: txRecordId,
          sessionId: matchedSessionRow.id,
          routingRuleId: target.routingRuleId,
          data: {
            session: sessionEvent.session,
            transaction: storedTx,
          },
        },
        {
          sync: options?.syncWebhooks,
          fetchImpl: options?.fetchImpl,
          nowMs,
        }
      );
      deliveries.push(dlv);
    }
  }

  return {
    status: 'parsed',
    transaction: storedTx,
    matchedOrderCode,
    sessionAction,
    sessionId,
    deliveries,
  };
}
