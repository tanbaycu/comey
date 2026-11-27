import { Hono } from 'hono';
import type { WebhookDeliveryRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { requireLiveAuth, requireScope, requireWorkspaceAuth } from '../middleware/auth.js';
import { dispatchDeliveryById } from '../services/webhookDelivery.js';

type DeliveryListRow = Omit<WebhookDeliveryRow, 'webhook_secret_enc' | 'payload_json'>;

const DELIVERY_LIST_COLUMNS = `id, workspace_id, event_id, event_type, target_url, payload_format,
  transaction_id, session_id, routing_rule_id, status, attempt_count, max_attempts,
  last_http_status, last_error, last_response_body, next_retry_at, delivered_at,
  created_at, updated_at`;

function sanitizeDelivery(row: DeliveryListRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    targetUrl: row.target_url,
    payloadFormat: row.payload_format ?? 'comey',
    transactionId: row.transaction_id,
    sessionId: row.session_id,
    routingRuleId: row.routing_rule_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastHttpStatus: row.last_http_status,
    lastError: row.last_error,
    lastResponseBody: row.last_response_body,
    nextRetryAt: row.next_retry_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDeliveryRoutes(options?: {
  webhookFetch?: typeof fetch;
}): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();
  app.use('*', requireWorkspaceAuth);
  app.use('*', requireLiveAuth);

  app.get('/', requireScope('webhooks:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const status = c.req.query('status');
    const limitRaw = Number.parseInt(c.req.query('limit') || '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    // PERF-L3: Explicit column projection omits payload_json & webhook_secret_enc
    const query = status
      ? c.env.DB.prepare(
          `SELECT ${DELIVERY_LIST_COLUMNS} FROM webhook_deliveries
           WHERE workspace_id = ? AND status = ?
           ORDER BY created_at DESC LIMIT ?`
        ).bind(workspaceId, status, limit)
      : c.env.DB.prepare(
          `SELECT ${DELIVERY_LIST_COLUMNS} FROM webhook_deliveries
           WHERE workspace_id = ?
           ORDER BY created_at DESC LIMIT ?`
        ).bind(workspaceId, limit);

    const rows = await query.all<DeliveryListRow>();
    return c.json({ ok: true, deliveries: rows.results.map(sanitizeDelivery) });
  });

  app.get('/:id', requireScope('webhooks:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT ${DELIVERY_LIST_COLUMNS}, payload_json
       FROM webhook_deliveries
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<DeliveryListRow & { payload_json: string }>();
    if (!row) {
      return c.json({ ok: false, error: 'Delivery not found' }, 404);
    }
    return c.json({
      ok: true,
      delivery: {
        ...sanitizeDelivery(row),
        payloadJson: row.payload_json,
      },
    });
  });

  app.post('/:id/replay', requireLiveAuth, requireScope('webhooks:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id') || '';

    const existing = await c.env.DB.prepare(
      `SELECT * FROM webhook_deliveries WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<WebhookDeliveryRow>();

    if (!existing) {
      return c.json({ ok: false, error: 'Delivery not found' }, 404);
    }

    // LOW-4: Refresh routing rule secret on replay if routing_rule_id still exists
    const res = await dispatchDeliveryById(c.env, existing.id, {
      fetchImpl: options?.webhookFetch,
      row: existing,
      refreshRuleSecret: true,
    });
    return c.json({ ok: true, delivery: res });
  });

  return app;
}
