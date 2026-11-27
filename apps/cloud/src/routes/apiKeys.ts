import {
  API_KEY_PRESETS,
  API_KEY_SCOPES,
  generateApiKey,
  normalizeApiScopes,
  parseAllowedIps,
  randomHex,
} from '@comey/core';
import { Hono } from 'hono';
import type { AppContextEnv } from '../env.js';
import { requireSessionAuth } from '../middleware/auth.js';
import { getClientIp } from '../middleware/rateLimit.js';
import { recordAuditLog } from '../services/audit.js';

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  is_test: number;
  scopes_json: string | null;
  rate_limit_rpm: number | null;
  allowed_ips: string | null;
  enabled: number | null;
  expires_at: string | null;
  request_count: number | null;
  error_count: number | null;
  last_ip_hash: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string | null;
}

const API_KEY_SELECT_COLUMNS = `
  id, workspace_id, name, description, key_prefix, is_test,
  scopes_json, rate_limit_rpm, allowed_ips, enabled, expires_at,
  request_count, error_count, last_ip_hash, last_used_at, revoked_at,
  created_at, updated_at
`;

function safeParseArray(raw: string | null, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : fallback;
  } catch {
    return fallback;
  }
}

function sanitizeApiKey(row: ApiKeyRow) {
  const enabled = row.enabled === null ? true : row.enabled === 1;
  const expired = Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
  const status: 'revoked' | 'expired' | 'paused' | 'active' = row.revoked_at
    ? 'revoked'
    : expired
      ? 'expired'
      : !enabled
        ? 'paused'
        : 'active';

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    key_prefix: row.key_prefix,
    keyPrefix: row.key_prefix,
    is_test: row.is_test,
    isTest: row.is_test === 1,
    scopes: safeParseArray(row.scopes_json, ['*']),
    rateLimitRpm: Number(row.rate_limit_rpm ?? 120),
    allowedIps: safeParseArray(row.allowed_ips, []),
    enabled,
    expiresAt: row.expires_at ?? null,
    requestCount: Number(row.request_count ?? 0),
    errorCount: Number(row.error_count ?? 0),
    lastIpHash: row.last_ip_hash ?? null,
    last_used_at: row.last_used_at ?? null,
    revoked_at: row.revoked_at ?? null,
    created_at: row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    status,
  };
}

function validateRpm(raw: unknown, fallback: number): number | null {
  if (raw === undefined) return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 10 || num > 600) {
    return null;
  }
  return num;
}

function computeExpiresAt(
  expiresInDays: unknown
): { ok: true; expiresAt: string | null } | { ok: false; error: string } {
  if (expiresInDays === undefined || expiresInDays === null || expiresInDays === '') {
    return { ok: true, expiresAt: null };
  }
  const days = Number(expiresInDays);
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1 || days > 3650) {
    return { ok: false, error: 'expiresInDays phải là số nguyên từ 1 đến 3650 ngày' };
  }
  return {
    ok: true,
    expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000).toISOString(),
  };
}

export function createApiKeyRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();
  // Security boundary: API keys (even ['*']) can NEVER create, edit, rotate, or revoke API keys
  app.use('*', requireSessionAuth);

  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId');
    const rows = await c.env.DB.prepare(
      `SELECT ${API_KEY_SELECT_COLUMNS}
       FROM api_keys
       WHERE workspace_id = ?
       ORDER BY created_at DESC`
    )
      .bind(workspaceId)
      .all<ApiKeyRow>();

    return c.json({
      ok: true,
      apiKeys: rows.results.map(sanitizeApiKey),
      availableScopes: API_KEY_SCOPES,
      presets: API_KEY_PRESETS,
    });
  });

  app.get('/logs', async (c) => {
    const workspaceId = c.get('workspaceId');
    const apiKeyId = (c.req.query('apiKeyId') || '').trim();
    const statusFilter = (c.req.query('status') || '').trim().toLowerCase();
    const limitRaw = Number.parseInt(c.req.query('limit') || '100', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 100;

    const conditions = ['l.workspace_id = ?'];
    const params: Array<string | number> = [workspaceId];

    if (apiKeyId) {
      conditions.push('l.api_key_id = ?');
      params.push(apiKeyId);
    }
    if (statusFilter === 'error') {
      conditions.push('l.status_code >= 400');
    } else if (statusFilter === 'ok') {
      conditions.push('l.status_code < 400');
    }
    params.push(limit);

    const since24hIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [logsRes, summaryRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT l.id, l.api_key_id, k.name AS api_key_name, k.key_prefix,
                l.method, l.path, l.status_code, l.latency_ms, l.ip_hash, l.error_code, l.created_at
         FROM api_request_logs l
         JOIN api_keys k ON k.id = l.api_key_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY l.created_at DESC
         LIMIT ?`
      )
        .bind(...params)
        .all<{
          id: string;
          api_key_id: string;
          api_key_name: string;
          key_prefix: string;
          method: string;
          path: string;
          status_code: number;
          latency_ms: number;
          ip_hash: string | null;
          error_code: string | null;
          created_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT
           COUNT(*) AS total_24h,
           SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_24h,
           SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END) AS rate_limited_24h,
           COALESCE(ROUND(AVG(latency_ms)), 0) AS avg_latency_ms
         FROM api_request_logs
         WHERE workspace_id = ? AND created_at >= ?`
      )
        .bind(workspaceId, since24hIso)
        .first<{
          total_24h: number;
          error_24h: number | null;
          rate_limited_24h: number | null;
          avg_latency_ms: number | null;
        }>(),
    ]);

    return c.json({
      ok: true,
      logs: logsRes.results.map((r) => ({
        id: r.id,
        apiKeyId: r.api_key_id,
        apiKeyName: r.api_key_name,
        keyPrefix: r.key_prefix,
        method: r.method,
        path: r.path,
        statusCode: Number(r.status_code),
        latencyMs: Number(r.latency_ms),
        ipHash: r.ip_hash,
        errorCode: r.error_code,
        createdAt: r.created_at,
      })),
      summary: {
        totalRequests24h: Number(summaryRes?.total_24h ?? 0),
        errorRequests24h: Number(summaryRes?.error_24h ?? 0),
        rateLimited24h: Number(summaryRes?.rate_limited_24h ?? 0),
        avgLatencyMs: Number(summaryRes?.avg_latency_ms ?? 0),
      },
    });
  });

  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId');
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      description?: string;
      isTest?: boolean;
      scopes?: unknown;
      rateLimitRpm?: unknown;
      allowedIps?: string | string[] | null;
      expiresInDays?: unknown;
    } | null;

    const name = String(body?.name || '').trim() || 'Default Key';
    const description = body?.description ? String(body.description).trim().slice(0, 240) : null;
    const isTest = Boolean(body?.isTest);

    const scopes =
      body?.scopes !== undefined ? normalizeApiScopes(body.scopes) : (['*'] as const);
    if (scopes.length === 0) {
      return c.json({ ok: false, error: 'Danh sách quyền (scopes) không hợp lệ' }, 400);
    }

    const rateLimitRpm = validateRpm(body?.rateLimitRpm, 120);
    if (rateLimitRpm === null) {
      return c.json({ ok: false, error: 'rateLimitRpm phải nằm trong khoảng 10–600' }, 400);
    }

    const ipCheck = parseAllowedIps(body?.allowedIps);
    if (!ipCheck.ok) {
      return c.json({ ok: false, error: ipCheck.reason }, 400);
    }

    const expCheck = computeExpiresAt(body?.expiresInDays);
    if (!expCheck.ok) {
      return c.json({ ok: false, error: expCheck.error }, 400);
    }

    const generated = await generateApiKey(isTest ? 'cm_test_' : 'cm_live_');
    const id = `key_${randomHex(10)}`;
    const nowIso = new Date().toISOString();
    const scopesJson = JSON.stringify(scopes);
    const allowedIpsJson = ipCheck.ips.length > 0 ? JSON.stringify(ipCheck.ips) : null;

    await c.env.DB.prepare(
      `INSERT INTO api_keys (
        id, workspace_id, name, description, key_prefix, key_hash, is_test,
        scopes_json, rate_limit_rpm, allowed_ips, enabled, expires_at,
        request_count, error_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?, ?)`
    )
      .bind(
        id,
        workspaceId,
        name,
        description,
        generated.keyPrefix,
        generated.keyHash,
        isTest ? 1 : 0,
        scopesJson,
        rateLimitRpm,
        allowedIpsJson,
        expCheck.expiresAt,
        nowIso,
        nowIso
      )
      .run();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: c.get('userId'),
      action: 'api_key.created',
      resourceType: 'api_key',
      resourceId: id,
      ip: getClientIp(c),
      meta: {
        name,
        keyPrefix: generated.keyPrefix,
        isTest,
        scopes,
        rateLimitRpm,
        hasIpAllowlist: ipCheck.ips.length > 0,
        expiresAt: expCheck.expiresAt,
      },
    });

    const created = await c.env.DB.prepare(
      `SELECT ${API_KEY_SELECT_COLUMNS} FROM api_keys WHERE id = ?`
    )
      .bind(id)
      .first<ApiKeyRow>();

    return c.json(
      {
        ok: true,
        apiKey: {
          ...sanitizeApiKey(created!),
          plaintextKey: generated.plaintext,
        },
      },
      201
    );
  });

  app.patch('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT ${API_KEY_SELECT_COLUMNS} FROM api_keys WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<ApiKeyRow>();

    if (!existing) {
      return c.json({ ok: false, error: 'API key not found' }, 404);
    }
    if (existing.revoked_at) {
      return c.json({ ok: false, error: 'Cannot modify a revoked API key' }, 409);
    }

    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      description?: string | null;
      scopes?: unknown;
      rateLimitRpm?: unknown;
      allowedIps?: string | string[] | null;
      enabled?: boolean;
      expiresInDays?: unknown;
      expiresAt?: string | null;
    } | null;

    const nextName =
      body?.name !== undefined ? String(body.name).trim() || existing.name : existing.name;
    const nextDescription =
      body?.description !== undefined
        ? body.description
          ? String(body.description).trim().slice(0, 240)
          : null
        : existing.description;

    let nextScopesJson = existing.scopes_json ?? '["*"]';
    if (body?.scopes !== undefined) {
      const normalized = normalizeApiScopes(body.scopes);
      if (normalized.length === 0) {
        return c.json({ ok: false, error: 'Danh sách quyền (scopes) không hợp lệ' }, 400);
      }
      nextScopesJson = JSON.stringify(normalized);
    }

    const nextRpm = validateRpm(body?.rateLimitRpm, Number(existing.rate_limit_rpm ?? 120));
    if (nextRpm === null) {
      return c.json({ ok: false, error: 'rateLimitRpm phải nằm trong khoảng 10–600' }, 400);
    }

    let nextAllowedIps = existing.allowed_ips;
    if (body?.allowedIps !== undefined) {
      const ipCheck = parseAllowedIps(body.allowedIps);
      if (!ipCheck.ok) {
        return c.json({ ok: false, error: ipCheck.reason }, 400);
      }
      nextAllowedIps = ipCheck.ips.length > 0 ? JSON.stringify(ipCheck.ips) : null;
    }

    let nextExpiresAt = existing.expires_at;
    if (body?.expiresInDays !== undefined) {
      const expCheck = computeExpiresAt(body.expiresInDays);
      if (!expCheck.ok) {
        return c.json({ ok: false, error: expCheck.error }, 400);
      }
      nextExpiresAt = expCheck.expiresAt;
    } else if (body?.expiresAt === null) {
      nextExpiresAt = null;
    }

    const nextEnabled =
      body?.enabled !== undefined ? (body.enabled ? 1 : 0) : (existing.enabled ?? 1);
    const nowIso = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE api_keys
       SET name = ?, description = ?, scopes_json = ?, rate_limit_rpm = ?,
           allowed_ips = ?, enabled = ?, expires_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(
        nextName,
        nextDescription,
        nextScopesJson,
        nextRpm,
        nextAllowedIps,
        nextEnabled,
        nextExpiresAt,
        nowIso,
        id,
        workspaceId
      )
      .run();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: c.get('userId'),
      action: 'api_key.updated',
      resourceType: 'api_key',
      resourceId: id,
      ip: getClientIp(c),
      meta: {
        name: nextName,
        enabled: nextEnabled === 1,
        rateLimitRpm: nextRpm,
        hasIpAllowlist: Boolean(nextAllowedIps),
        expiresAt: nextExpiresAt,
      },
    });

    const updated = await c.env.DB.prepare(
      `SELECT ${API_KEY_SELECT_COLUMNS} FROM api_keys WHERE id = ?`
    )
      .bind(id)
      .first<ApiKeyRow>();

    return c.json({ ok: true, apiKey: sanitizeApiKey(updated!) });
  });

  app.post('/:id/rotate', async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT ${API_KEY_SELECT_COLUMNS} FROM api_keys WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<ApiKeyRow>();

    if (!existing) {
      return c.json({ ok: false, error: 'API key not found' }, 404);
    }
    if (existing.revoked_at) {
      return c.json({ ok: false, error: 'Cannot rotate a revoked API key' }, 409);
    }

    const generated = await generateApiKey(existing.is_test === 1 ? 'cm_test_' : 'cm_live_');
    const nowIso = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE api_keys
       SET key_prefix = ?, key_hash = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(generated.keyPrefix, generated.keyHash, nowIso, id, workspaceId)
      .run();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: c.get('userId'),
      action: 'api_key.rotated',
      resourceType: 'api_key',
      resourceId: id,
      ip: getClientIp(c),
      meta: { newKeyPrefix: generated.keyPrefix },
    });

    const updated = await c.env.DB.prepare(
      `SELECT ${API_KEY_SELECT_COLUMNS} FROM api_keys WHERE id = ?`
    )
      .bind(id)
      .first<ApiKeyRow>();

    return c.json({
      ok: true,
      apiKey: {
        ...sanitizeApiKey(updated!),
        plaintextKey: generated.plaintext,
      },
    });
  });

  app.delete('/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const nowIso = new Date().toISOString();

    const res = await c.env.DB.prepare(
      `UPDATE api_keys
       SET revoked_at = ?, enabled = 0, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`
    )
      .bind(nowIso, nowIso, id, workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      return c.json({ ok: false, error: 'API key not found or already revoked' }, 404);
    }

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: c.get('userId'),
      action: 'api_key.revoked',
      resourceType: 'api_key',
      resourceId: id,
      ip: getClientIp(c),
    });

    return c.json({ ok: true });
  });

  return app;
}
