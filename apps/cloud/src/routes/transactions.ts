import { getBankMetadata, randomHex } from '@comey/core';
import { Hono } from 'hono';
import type { BankAccountRow, TransactionRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { requireScope, requireWorkspaceAuth } from '../middleware/auth.js';
import { ingestRawEmailForAccount } from '../services/ingest.js';

function sanitizeTx(row: TransactionRow) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    bankCode: row.bank_code,
    bankBin: row.bank_bin,
    bankTxId: row.bank_tx_id,
    accountNumber: row.account_number,
    direction: row.direction,
    amount: row.amount,
    currency: row.currency,
    content: row.content,
    occurredAt: row.occurred_at,
    senderName: row.sender_name,
    senderBank: row.sender_bank,
    source: row.source,
    authStatus: row.auth_status,
    authDkimDomain: row.auth_dkim_domain,
    matchedOrderCode: row.matched_order_code,
    matchedSessionId: row.matched_session_id,
    isTest: row.is_test === 1,
    createdAt: row.created_at,
  };
}

export function createTransactionRoutes(options?: {
  webhookFetch?: typeof fetch;
}): {
  transactions: Hono<AppContextEnv>;
  simulator: Hono<AppContextEnv>;
} {
  const transactions = new Hono<AppContextEnv>();
  transactions.use('*', requireWorkspaceAuth);

  transactions.get('/', requireScope('transactions:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const isTestKey = c.get('isTestKey');
    const bankAccountId = c.req.query('bankAccountId');
    const orderCode = c.req.query('orderCode')?.trim().toUpperCase();
    const since = c.req.query('since');
    const includeTestParam = c.req.query('includeTest');
    const includeTest = includeTestParam !== 'false';
    const limitRaw = Number.parseInt(c.req.query('limit') || '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    // CRIT-3: Sandbox API key cannot read live (is_test = 0) transactions
    if (isTestKey && includeTestParam === 'false') {
      return c.json(
        { ok: false, error: 'Sandbox API key (cm_test_) cannot read live transactions' },
        403
      );
    }

    const clauses: string[] = ['workspace_id = ?'];
    const params: Array<string | number> = [workspaceId];

    if (isTestKey) {
      clauses.push('is_test = 1');
    } else if (!includeTest) {
      clauses.push('is_test = 0');
    }
    if (bankAccountId) {
      clauses.push('bank_account_id = ?');
      params.push(bankAccountId);
    }
    if (orderCode) {
      // PERF-H4: matched_order_code is stored uppercase so index idx_transactions_ws_order_created is used
      clauses.push('matched_order_code = ?');
      params.push(orderCode);
    }
    if (since) {
      clauses.push('occurred_at >= ?');
      params.push(since);
    }

    params.push(limit);

    const rows = await c.env.DB.prepare(
      `SELECT * FROM transactions
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(...params)
      .all<TransactionRow>();

    return c.json({
      ok: true,
      transactions: rows.results.map(sanitizeTx),
    });
  });

  transactions.get('/:id', requireScope('transactions:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const isTestKey = c.get('isTestKey');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT * FROM transactions WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<TransactionRow>();

    if (!row) {
      return c.json({ ok: false, error: 'Transaction not found' }, 404);
    }
    if (isTestKey && row.is_test !== 1) {
      return c.json(
        { ok: false, error: 'Sandbox API key (cm_test_) cannot read live transactions' },
        403
      );
    }
    return c.json({ ok: true, transaction: sanitizeTx(row) });
  });

  const simulator = new Hono<AppContextEnv>();
  simulator.use('*', requireWorkspaceAuth);

  simulator.post('/transfer', requireScope('simulator:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const isTestKey = c.get('isTestKey');
    const isCookieOwner = !isTestKey && Boolean(c.get('userId'));

    const body = (await c.req.json().catch(() => null)) as {
      bankAccountId?: string;
      amount?: number;
      content?: string;
      senderName?: string;
      senderBank?: string;
      txId?: string;
      allowLiveSessionMatch?: boolean;
      allowExternalWebhooks?: boolean;
    } | null;

    const bankAccountId = String(body?.bankAccountId || '').trim();
    const amount = Math.floor(Number(body?.amount || 0));
    const content = String(body?.content || '').trim();

    if (!bankAccountId) {
      return c.json({ ok: false, error: 'bankAccountId is required' }, 400);
    }
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10_000_000_000) {
      return c.json({ ok: false, error: 'amount must be a valid positive integer' }, 400);
    }
    if (!content) {
      return c.json({ ok: false, error: 'content is required' }, 400);
    }

    const account = await c.env.DB.prepare(
      `SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ?`
    )
      .bind(bankAccountId, workspaceId)
      .first<BankAccountRow>();

    if (!account) {
      return c.json({ ok: false, error: 'Bank account not found' }, 404);
    }

    const txId = String(body?.txId || '').trim() || `SIM${randomHex(6).toUpperCase()}`;
    const senderName = String(body?.senderName || 'SIMULATOR USER').trim();
    const senderBank = String(body?.senderBank || 'VCB').trim();
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
    const vnDateStr = `${pad(vnTime.getUTCDate())}/${pad(vnTime.getUTCMonth() + 1)}/${vnTime.getUTCFullYear()} ${pad(vnTime.getUTCHours())}:${pad(vnTime.getUTCMinutes())}:${pad(vnTime.getUTCSeconds())}`;

    const formattedAmount = amount.toLocaleString('en-US').replace(/,/g, '.');
    const SUPPORTED_SIM_BANKS = new Set([
      'CAKE',
      'MB',
      'VCB',
      'TECHCOMBANK',
      'TIMO',
      'ACB',
    ]);
    const bankMeta = getBankMetadata(account.bank_code);
    const simDomain =
      bankMeta && SUPPORTED_SIM_BANKS.has(bankMeta.code) && bankMeta.emailDomains[0]
        ? bankMeta.emailDomains[0]
        : 'cake.vn';

    const simulatedEmail = {
      source: 'simulator' as const,
      messageId: `<sim_${txId}@simulator.comey.local>`,
      from: `no-reply@${simDomain}`,
      subject: '[SIMULATOR] Thông báo biến động số dư',
      textBody: [
        `Tài khoản nhận: ${account.account_number}`,
        `Số tiền: +${formattedAmount} đ`,
        `Ngày giờ giao dịch: ${vnDateStr}`,
        `Mã giao dịch: ${txId}`,
        `Tên người chuyển: ${senderName}`,
        `Ngân hàng chuyển: ${senderBank}`,
        `Nội dung giao dịch: ${content}`,
      ].join('\n'),
    };

    // CRIT-3: Enforce strict sandbox isolation:
    // - cm_test_ keys NEVER match live sessions and ONLY dispatch to SANDBOX_WEBHOOK_URL.
    // - Cookie-authenticated Dashboard owners default to allowing live session testing (Test Paid UX),
    //   while external SePay/PayOS webhooks require explicit allowExternalWebhooks: true.
    const allowLiveSessionMatch = isTestKey
      ? false
      : isCookieOwner
        ? body?.allowLiveSessionMatch !== false
        : body?.allowLiveSessionMatch === true;
    const sandboxWebhooksOnly = isTestKey;
    const allowExternalCompatWebhooks = isTestKey ? false : body?.allowExternalWebhooks === true;

    const result = await ingestRawEmailForAccount(
      c.env,
      undefined,
      account,
      simulatedEmail,
      {
        syncWebhooks: true,
        fetchImpl: options?.webhookFetch,
        allowLiveSessionMatch,
        sandboxWebhooksOnly,
        allowExternalCompatWebhooks,
      }
    );

    return c.json({ ok: true, simulation: result });
  });

  return { transactions, simulator };
}
