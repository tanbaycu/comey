import { expireSessionIfPastDeadline } from '@comey/core';
import { rowToPaymentSession, type PaymentSessionRow } from '../db/types.js';
import type { Env } from '../env.js';
import { isSandboxWebhookUrl } from '../security/urlGuard.js';
import {
  createAndScheduleDelivery,
  processPendingWebhookRetries,
} from './webhookDelivery.js';

export interface MaintenanceSummary {
  retriedWebhooks: number;
  expiredSessions: number;
  purgedQuarantine: number;
  purgedAuthSessions: number;
}

export async function runScheduledMaintenance(
  env: Env,
  options?: { nowMs?: number; fetchImpl?: typeof fetch; forceCleanup?: boolean }
): Promise<MaintenanceSummary> {
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Retry pending/retrying webhook deliveries
  const retriedWebhooks = await processPendingWebhookRetries(env, {
    nowMs,
    limit: 25,
    fetchImpl: options?.fetchImpl,
  });

  // 2. Expire overdue pending/underpaid payment sessions
  const overdueSessions = await env.DB.prepare(
    `SELECT * FROM payment_sessions
     WHERE status IN ('pending', 'underpaid') AND expires_at <= ?
     ORDER BY expires_at ASC
     LIMIT 50`
  )
    .bind(nowIso)
    .all<PaymentSessionRow>();

  let expiredSessions = 0;
  for (const row of overdueSessions.results) {
    const coreSession = rowToPaymentSession(row);
    const check = expireSessionIfPastDeadline(coreSession, nowMs);
    if (!check.expired) continue;

    const updateRes = await env.DB.prepare(
      `UPDATE payment_sessions
       SET status = 'expired', updated_at = ?
       WHERE id = ? AND status IN ('pending', 'underpaid')`
    )
      .bind(nowIso, row.id)
      .run();

    if ((updateRes.meta?.changes ?? 0) > 0) {
      expiredSessions++;
      const isTestSession = row.is_test === 1;
      if (
        row.webhook_url &&
        row.webhook_secret_enc &&
        (!isTestSession || isSandboxWebhookUrl(row.webhook_url))
      ) {
        await createAndScheduleDelivery(
          env,
          undefined,
          {
            workspaceId: row.workspace_id,
            eventType: 'session.expired',
            targetUrl: row.webhook_url,
            webhookSecretEnc: row.webhook_secret_enc,
            isTest: isTestSession,
            sessionId: row.id,
            data: { session: check.session },
          },
          {
            sync: true,
            fetchImpl: options?.fetchImpl,
            nowMs,
          }
        );
      }
    }
  }

  // PERF-H4: Run heavy table cleanup hourly (minute 0 UTC) or when explicitly forced
  const shouldRunCleanup =
    options?.forceCleanup === true || new Date(nowMs).getUTCMinutes() === 0;

  let purgedQuarantine = 0;
  let purgedAuthSessions = 0;

  if (shouldRunCleanup) {
    // 3. Enforce 72h Privacy-First Quarantine TTL
    const qDel = await env.DB.prepare(`DELETE FROM quarantine_emails WHERE expires_at <= ?`)
      .bind(nowIso)
      .run();
    purgedQuarantine = qDel.meta?.changes ?? 0;

    // 4. Clean expired auth sessions, rate limit buckets & 90d audit logs
    const sDel = await env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`)
      .bind(nowIso)
      .run();
    purgedAuthSessions = sDel.meta?.changes ?? 0;

    await env.DB.prepare(`DELETE FROM rate_limits WHERE reset_at <= ?`)
      .bind(nowIso)
      .run()
      .catch(() => {});

    const auditCutoffIso = new Date(nowMs - 90 * 24 * 3600 * 1000).toISOString();
    await env.DB.prepare(`DELETE FROM audit_logs WHERE created_at <= ?`)
      .bind(auditCutoffIso)
      .run()
      .catch(() => {});

    const apiLogCutoffIso = new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString();
    await env.DB.prepare(`DELETE FROM api_request_logs WHERE created_at <= ?`)
      .bind(apiLogCutoffIso)
      .run()
      .catch(() => {});
  }

  return {
    retriedWebhooks,
    expiredSessions,
    purgedQuarantine,
    purgedAuthSessions,
  };
}
