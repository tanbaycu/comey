import { Hono } from 'hono';
import type { AppContextEnv } from '../env.js';
import { requireLiveAuth, requireScope, requireWorkspaceAuth } from '../middleware/auth.js';

interface AuditRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_hash: string | null;
  meta_json: string | null;
  created_at: string;
}

export function createSecurityRoutes(): {
  auditLogs: Hono<AppContextEnv>;
  securitySummary: Hono<AppContextEnv>;
} {
  const auditLogs = new Hono<AppContextEnv>();
  auditLogs.use('*', requireWorkspaceAuth);
  auditLogs.use('*', requireLiveAuth);

  auditLogs.get('/', requireScope('security:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const limitRaw = Number.parseInt(c.req.query('limit') || '100', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 100;

    const rows = await c.env.DB.prepare(
      `SELECT id, actor_type, actor_id, action, resource_type, resource_id, ip_hash, meta_json, created_at
       FROM audit_logs
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(workspaceId, limit)
      .all<AuditRow>();

    return c.json({
      ok: true,
      auditLogs: rows.results.map((r) => {
        let meta: Record<string, unknown> | null = null;
        if (r.meta_json) {
          try {
            meta = JSON.parse(r.meta_json) as Record<string, unknown>;
          } catch {
            meta = null;
          }
        }
        return {
          id: r.id,
          actorType: r.actor_type,
          actorId: r.actor_id,
          action: r.action,
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          ipHash: r.ip_hash,
          meta,
          createdAt: r.created_at,
        };
      }),
    });
  });

  const securitySummary = new Hono<AppContextEnv>();
  securitySummary.use('*', requireWorkspaceAuth);
  securitySummary.use('*', requireLiveAuth);

  securitySummary.get('/summary', requireScope('security:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const [accountsAgg, keysAgg, quarantineAgg, retryingAgg, auditAgg] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN strict_auth = 1 THEN 1 ELSE 0 END) AS strict_count
         FROM bank_accounts WHERE workspace_id = ?`
      )
        .bind(workspaceId)
        .first<{ total: number; strict_count: number | null }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS active_count FROM api_keys WHERE workspace_id = ? AND revoked_at IS NULL`
      )
        .bind(workspaceId)
        .first<{ active_count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS open_count FROM quarantine_emails WHERE workspace_id = ? AND status = 'quarantined'`
      )
        .bind(workspaceId)
        .first<{ open_count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS retry_count FROM webhook_deliveries WHERE workspace_id = ? AND status IN ('retrying', 'failed')`
      )
        .bind(workspaceId)
        .first<{ retry_count: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS total FROM audit_logs WHERE workspace_id = ?`)
        .bind(workspaceId)
        .first<{ total: number }>(),
    ]);

    return c.json({
      ok: true,
      summary: {
        totalAccounts: Number(accountsAgg?.total ?? 0),
        strictAuthAccounts: Number(accountsAgg?.strict_count ?? 0),
        activeApiKeys: Number(keysAgg?.active_count ?? 0),
        openQuarantineCount: Number(quarantineAgg?.open_count ?? 0),
        retryingDeliveries: Number(retryingAgg?.retry_count ?? 0),
        recentAuditCount: Number(auditAgg?.total ?? 0),
        ssrfGuardEnabled: true,
        csrfGuardEnabled: true,
        redirectBlocked: true,
      },
    });
  });

  return { auditLogs, securitySummary };
}
