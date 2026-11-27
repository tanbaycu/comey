import { Hono } from 'hono';
import type { QuarantineEmailRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { requireLiveAuth, requireScope, requireWorkspaceAuth } from '../middleware/auth.js';
import { getClientIp } from '../middleware/rateLimit.js';
import { recordAuditLog } from '../services/audit.js';

function sanitizeQuarantine(row: QuarantineEmailRow) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    source: row.source,
    bankCode: row.bank_code,
    sender: row.sender,
    subject: row.subject,
    reason: row.reason,
    authStatus: row.auth_status,
    rawHash: row.raw_hash,
    rawSnippet: row.raw_snippet,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function createQuarantineRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();
  app.use('*', requireWorkspaceAuth);
  app.use('*', requireLiveAuth);

  app.get('/', requireScope('quarantine:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const status = c.req.query('status') || 'quarantined';
    const rows = await c.env.DB.prepare(
      `SELECT * FROM quarantine_emails
       WHERE workspace_id = ? AND status = ?
       ORDER BY created_at DESC
       LIMIT 100`
    )
      .bind(workspaceId, status)
      .all<QuarantineEmailRow>();

    return c.json({
      ok: true,
      quarantine: rows.results.map(sanitizeQuarantine),
    });
  });

  app.post('/:id/dismiss', requireLiveAuth, requireScope('quarantine:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const res = await c.env.DB.prepare(
      `UPDATE quarantine_emails SET status = 'dismissed'
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      return c.json({ ok: false, error: 'Quarantine entry not found' }, 404);
    }
    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'quarantine.dismissed',
      resourceType: 'quarantine',
      resourceId: id,
      ip: getClientIp(c),
    });
    return c.json({ ok: true });
  });

  app.delete('/:id', requireLiveAuth, requireScope('quarantine:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const res = await c.env.DB.prepare(
      `DELETE FROM quarantine_emails WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      return c.json({ ok: false, error: 'Quarantine entry not found' }, 404);
    }
    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'quarantine.deleted',
      resourceType: 'quarantine',
      resourceId: id,
      ip: getClientIp(c),
    });
    return c.json({ ok: true });
  });

  return app;
}
