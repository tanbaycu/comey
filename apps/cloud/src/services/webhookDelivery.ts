import {
  decryptSecret,
  randomHex,
  signWebhookPayload,
  type WebhookEvent,
  type WebhookEventType,
  type WebhookPayloadFormat,
} from '@comey/core';
import type { WebhookDeliveryRow } from '../db/types.js';
import type { Env } from '../env.js';
import {
  isSandboxWebhookUrl,
  parseTelegramChatId,
  validateAppsScriptUrl,
  validateSafeOutboundUrl,
} from '../security/urlGuard.js';

export const BACKOFF_SECONDS = [60, 120, 300, 900, 3600] as const;
const RETRY_CONCURRENCY = 5;

export interface ScheduleDeliveryParams {
  workspaceId: string;
  eventType: WebhookEventType;
  targetUrl: string;
  webhookSecretEnc: string;
  isTest: boolean;
  data: unknown;
  payloadFormat?: WebhookPayloadFormat;
  preformattedPayloadJson?: string;
  transactionId?: string;
  sessionId?: string;
  routingRuleId?: string;
}

export interface DeliveryAttemptResult {
  deliveryId: string;
  eventId: string;
  eventType: string;
  targetUrl: string;
  status: 'pending' | 'delivered' | 'retrying' | 'failed';
  httpStatus: number | null;
  error: string | null;
}

async function readTruncatedResponse(resp: Response, maxChars = 512): Promise<string> {
  try {
    if (!resp.body) return '';
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    while (out.length < maxChars) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length >= maxChars) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return out.slice(0, maxChars);
  } catch {
    return '';
  }
}

export async function dispatchDeliveryRow(
  env: Env,
  row: WebhookDeliveryRow,
  options?: { fetchImpl?: typeof fetch; nowMs?: number; refreshRuleSecret?: boolean }
): Promise<DeliveryAttemptResult> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const nextAttempt = row.attempt_count + 1;

  let httpStatus: number | null = null;
  let errorMsg: string | null = null;
  let responseBody = '';
  let ok = false;

  try {
    if (isSandboxWebhookUrl(row.target_url)) {
      const mockBody = JSON.stringify({
        ok: true,
        sandbox: true,
        format: row.payload_format ?? 'comey',
        message: 'Captured locally inside Comey Sandbox Inbox (no outbound HTTP call)',
        receivedAt: nowIso,
      });
      await env.DB.prepare(
        `UPDATE webhook_deliveries
         SET status = 'delivered',
             attempt_count = ?,
             last_http_status = 200,
             last_error = NULL,
             last_response_body = ?,
             next_retry_at = NULL,
             delivered_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
        .bind(nextAttempt, mockBody, nowIso, nowIso, row.id)
        .run();

      return {
        deliveryId: row.id,
        eventId: row.event_id,
        eventType: row.event_type,
        targetUrl: row.target_url,
        status: 'delivered',
        httpStatus: 200,
        error: null,
      };
    }

    // LOW-4: On replay/retry, fetch latest routing rule secret if the rule still exists
    let effectiveSecretEnc = row.webhook_secret_enc;
    if (options?.refreshRuleSecret && row.routing_rule_id) {
      const ruleRow = await env.DB.prepare(
        `SELECT webhook_secret_enc FROM routing_rules WHERE id = ? AND workspace_id = ?`
      )
        .bind(row.routing_rule_id, row.workspace_id)
        .first<{ webhook_secret_enc: string }>();
      if (ruleRow?.webhook_secret_enc) {
        effectiveSecretEnc = ruleRow.webhook_secret_enc;
      }
    }

    const payloadFormat: WebhookPayloadFormat = row.payload_format ?? 'comey';
    let targetFetchUrl = '';
    let headers: Record<string, string>;
    let isGoogleAppsScriptTarget = false;

    if (payloadFormat === 'telegram') {
      const chatId = parseTelegramChatId(row.target_url);
      if (!chatId) {
        throw new Error('Invalid Telegram target chat ID');
      }
      const botToken = (await decryptSecret(effectiveSecretEnc, env.MASTER_ENCRYPTION_KEY)).trim();
      if (!/^\d{4,20}:[A-Za-z0-9_-]{16,120}$/.test(botToken)) {
        throw new Error('Invalid Telegram bot token format');
      }
      targetFetchUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Comey-Webhook/1.0 (Telegram)',
      };
    } else {
      const urlCheck = validateSafeOutboundUrl(row.target_url, { allowSandbox: true });
      if (!urlCheck.ok) {
        throw new Error(`SSRF blocked: ${urlCheck.reason}`);
      }
      targetFetchUrl = urlCheck.url;

      if (payloadFormat === 'sepay') {
        const apiKey = await decryptSecret(effectiveSecretEnc, env.MASTER_ENCRYPTION_KEY);
        headers = {
          'Content-Type': 'application/json',
          Authorization: `Apikey ${apiKey}`,
          'X-Comey-Event-Id': row.event_id,
          'X-Comey-Format': 'sepay',
          'User-Agent': 'Comey-Webhook/1.0 (SePay-Compat)',
        };
      } else if (payloadFormat === 'payos') {
        headers = {
          'Content-Type': 'application/json',
          'X-Comey-Event-Id': row.event_id,
          'X-Comey-Format': 'payos',
          'User-Agent': 'Comey-Webhook/1.0 (PayOS-Compat)',
        };
      } else if (payloadFormat === 'discord') {
        headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'Comey-Webhook/1.0 (Discord)',
        };
      } else if (payloadFormat === 'google_sheets') {
        isGoogleAppsScriptTarget = validateAppsScriptUrl(urlCheck.url).ok;
        headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'Comey-Webhook/1.0 (GoogleSheets)',
        };
      } else {
        const secret = await decryptSecret(effectiveSecretEnc, env.MASTER_ENCRYPTION_KEY);
        const signed = await signWebhookPayload(
          row.payload_json,
          secret,
          Math.floor(nowMs / 1000)
        );
        headers = {
          'Content-Type': 'application/json',
          'X-Comey-Signature': signed.header,
          'X-Comey-Event-Id': row.event_id,
          'X-Comey-Event-Type': row.event_type,
          'User-Agent': 'Comey-Webhook/1.0',
        };
      }
    }

    let resp = await fetchFn(targetFetchUrl, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: row.payload_json,
      signal: AbortSignal.timeout(8000),
    });

    // Google Apps Script Web Apps respond with 302 to script.googleusercontent.com after executing doPost
    if (isGoogleAppsScriptTarget && resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location') || '';
      try {
        const parsedLoc = new URL(loc);
        if (
          parsedLoc.protocol === 'https:' &&
          parsedLoc.hostname.toLowerCase() === 'script.googleusercontent.com' &&
          parsedLoc.port === ''
        ) {
          resp = await fetchFn(parsedLoc.toString(), {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(5000),
          });
        }
      } catch {
        // Keep redirect response so SSRF redirect block triggers below
      }
    }

    httpStatus = resp.status;
    if (resp.status >= 300 && resp.status < 400) {
      ok = false;
      errorMsg = `Redirect (${resp.status}) blocked for security`;
    } else {
      responseBody = await readTruncatedResponse(resp);
      ok = resp.ok;
      if (!ok) {
        errorMsg = `HTTP ${resp.status}`;
      }
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    errorMsg = rawMsg.replace(/bot\d+:[A-Za-z0-9_:-]+/gi, 'bot[REDACTED]');
  }

  if (ok) {
    await env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status = 'delivered',
           attempt_count = ?,
           last_http_status = ?,
           last_error = NULL,
           last_response_body = ?,
           next_retry_at = NULL,
           delivered_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(nextAttempt, httpStatus, responseBody || null, nowIso, nowIso, row.id)
      .run();

    return {
      deliveryId: row.id,
      eventId: row.event_id,
      eventType: row.event_type,
      targetUrl: row.target_url,
      status: 'delivered',
      httpStatus,
      error: null,
    };
  }

  const exhausted = nextAttempt >= row.max_attempts;
  const delaySec =
    BACKOFF_SECONDS[Math.min(nextAttempt - 1, BACKOFF_SECONDS.length - 1)] ?? 3600;
  const nextRetryAt = exhausted ? null : new Date(nowMs + delaySec * 1000).toISOString();
  const nextStatus: 'retrying' | 'failed' = exhausted ? 'failed' : 'retrying';

  await env.DB.prepare(
    `UPDATE webhook_deliveries
     SET status = ?,
         attempt_count = ?,
         last_http_status = ?,
         last_error = ?,
         last_response_body = ?,
         next_retry_at = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nextStatus,
      nextAttempt,
      httpStatus,
      errorMsg ? errorMsg.slice(0, 300) : 'Delivery failed',
      responseBody || null,
      nextRetryAt,
      nowIso,
      row.id
    )
    .run();

  return {
    deliveryId: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    targetUrl: row.target_url,
    status: nextStatus,
    httpStatus,
    error: errorMsg,
  };
}

export async function dispatchDeliveryById(
  env: Env,
  deliveryId: string,
  options?: {
    fetchImpl?: typeof fetch;
    nowMs?: number;
    row?: WebhookDeliveryRow;
    refreshRuleSecret?: boolean;
  }
): Promise<DeliveryAttemptResult | null> {
  const row =
    options?.row ??
    (await env.DB.prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`)
      .bind(deliveryId)
      .first<WebhookDeliveryRow>());

  if (!row) return null;

  return dispatchDeliveryRow(env, row, {
    fetchImpl: options?.fetchImpl,
    nowMs: options?.nowMs,
    refreshRuleSecret: options?.refreshRuleSecret,
  });
}

export async function createAndScheduleDelivery(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'> | undefined,
  params: ScheduleDeliveryParams,
  options?: { sync?: boolean; fetchImpl?: typeof fetch; nowMs?: number }
): Promise<DeliveryAttemptResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const deliveryId = `dlv_${randomHex(12)}`;
  const eventId = `evt_${randomHex(12)}`;

  const payloadFormat: WebhookPayloadFormat = params.payloadFormat ?? 'comey';
  const event: WebhookEvent = {
    id: eventId,
    type: params.eventType,
    createdAt: nowIso,
    isTest: params.isTest,
    data: params.data,
  };
  const payloadJson = params.preformattedPayloadJson ?? JSON.stringify(event);

  // PERF-M3: Populate next_retry_at = created_at on pending insert so retry queries can use index range seek
  await env.DB.prepare(
    `INSERT INTO webhook_deliveries (
      id, workspace_id, event_id, event_type, target_url, webhook_secret_enc,
      payload_format, payload_json, transaction_id, session_id, routing_rule_id,
      status, attempt_count, max_attempts, next_retry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 6, ?, ?, ?)`
  )
    .bind(
      deliveryId,
      params.workspaceId,
      eventId,
      params.eventType,
      params.targetUrl,
      params.webhookSecretEnc,
      payloadFormat,
      payloadJson,
      params.transactionId ?? null,
      params.sessionId ?? null,
      params.routingRuleId ?? null,
      nowIso,
      nowIso,
      nowIso
    )
    .run();

  const row: WebhookDeliveryRow = {
    id: deliveryId,
    workspace_id: params.workspaceId,
    event_id: eventId,
    event_type: params.eventType,
    target_url: params.targetUrl,
    webhook_secret_enc: params.webhookSecretEnc,
    payload_format: payloadFormat,
    payload_json: payloadJson,
    transaction_id: params.transactionId ?? null,
    session_id: params.sessionId ?? null,
    routing_rule_id: params.routingRuleId ?? null,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 6,
    last_http_status: null,
    last_error: null,
    last_response_body: null,
    next_retry_at: nowIso,
    delivered_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  if (options?.sync || !ctx) {
    return dispatchDeliveryRow(env, row, {
      fetchImpl: options?.fetchImpl,
      nowMs,
    });
  }

  ctx.waitUntil(
    dispatchDeliveryRow(env, row, {
      fetchImpl: options?.fetchImpl,
      nowMs,
    }).then(() => undefined)
  );

  return {
    deliveryId,
    eventId,
    eventType: params.eventType,
    targetUrl: params.targetUrl,
    status: 'pending',
    httpStatus: null,
    error: null,
  };
}

export async function processPendingWebhookRetries(
  env: Env,
  options?: { nowMs?: number; limit?: number; fetchImpl?: typeof fetch }
): Promise<number> {
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const limit = Math.max(1, Math.min(100, options?.limit ?? 25));

  const pending = await env.DB.prepare(
    `SELECT * FROM webhook_deliveries
     WHERE status IN ('pending', 'retrying')
       AND next_retry_at <= ?
     ORDER BY next_retry_at ASC
     LIMIT ?`
  )
    .bind(nowIso, limit)
    .all<WebhookDeliveryRow>();

  const rows = pending.results;
  let processed = 0;

  // PERF-M3: Dispatch retries in bounded concurrency chunks of 5
  for (let i = 0; i < rows.length; i += RETRY_CONCURRENCY) {
    const chunk = rows.slice(i, i + RETRY_CONCURRENCY);
    await Promise.all(
      chunk.map((row) =>
        dispatchDeliveryRow(env, row, {
          fetchImpl: options?.fetchImpl,
          nowMs,
          refreshRuleSecret: true,
        })
      )
    );
    processed += chunk.length;
  }

  return processed;
}
