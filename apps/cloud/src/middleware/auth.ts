import {
  hasApiScope,
  isIpAllowed,
  normalizeApiScopes,
  randomHex,
  sha256Hex,
  type ApiKeyScope,
} from '@comey/core';
import type { Context, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppContextEnv } from '../env.js';
import { checkLocalRateLimit, getClientIp } from './rateLimit.js';

export const SESSION_COOKIE_NAME = 'comey_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const API_KEY_LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export function setSessionCookie(c: Context<AppContextEnv>, token: string): void {
  const isHttps = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context<AppContextEnv>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

interface SessionLookupRow {
  user_id: string;
  workspace_id: string;
  expires_at: string;
  email: string;
  role: string;
}

interface ApiKeyLookupRow {
  id: string;
  workspace_id: string;
  is_test: number;
  last_used_at: string | null;
  scopes_json: string | null;
  rate_limit_rpm: number | null;
  allowed_ips: string | null;
  enabled: number | null;
  expires_at: string | null;
}

function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function scheduleApiKeyTelemetry(
  c: Context<AppContextEnv>,
  params: {
    workspaceId: string;
    apiKeyId: string;
    clientIp: string;
    statusCode: number;
    latencyMs: number;
    errorCode: string | null;
    updateLastUsed: boolean;
  }
): Promise<void> {
  const nowIso = new Date().toISOString();
  const ipHash = params.clientIp ? (await sha256Hex(params.clientIp)).slice(0, 16) : null;
  const isError = params.statusCode >= 400 ? 1 : 0;
  const logId = `req_${randomHex(10)}`;
  const path = c.req.path.slice(0, 180);
  const method = c.req.method.toUpperCase().slice(0, 12);

  const work = c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO api_request_logs (
        id, workspace_id, api_key_id, method, path, status_code, latency_ms, ip_hash, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      logId,
      params.workspaceId,
      params.apiKeyId,
      method,
      path,
      params.statusCode,
      Math.max(0, Math.round(params.latencyMs)),
      ipHash,
      params.errorCode,
      nowIso
    ),
    c.env.DB.prepare(
      `UPDATE api_keys
       SET request_count = request_count + 1,
           error_count = error_count + ?,
           last_used_at = CASE WHEN ? = 1 THEN ? ELSE last_used_at END,
           last_ip_hash = CASE WHEN ? = 1 THEN COALESCE(?, last_ip_hash) ELSE last_ip_hash END
       WHERE id = ?`
    ).bind(
      isError,
      params.updateLastUsed ? 1 : 0,
      nowIso,
      params.updateLastUsed ? 1 : 0,
      ipHash,
      params.apiKeyId
    ),
  ]).catch(() => {});

  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}

export async function resolveCookieSession(
  c: Context<AppContextEnv>
): Promise<SessionLookupRow | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.user_id, s.workspace_id, s.expires_at, u.email, u.role
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first<SessionLookupRow>();

  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await c.env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run()
      .catch(() => {});
    return null;
  }
  return row;
}

export async function requireSessionAuth(
  c: Context<AppContextEnv>,
  next: Next
): Promise<Response | void> {
  const session = await resolveCookieSession(c);
  if (!session) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }
  c.set('workspaceId', session.workspace_id);
  c.set('userId', session.user_id);
  c.set('userEmail', session.email);
  c.set('userRole', session.role);
  c.set('isTestKey', false);
  await next();
}

export async function requireWorkspaceAuth(
  c: Context<AppContextEnv>,
  next: Next
): Promise<Response | void> {
  const rawAuthHeader = c.req.header('authorization');
  const rawApiKeyHeader = c.req.header('x-api-key');

  // SEC-H2: If ANY API auth header is present, NEVER fall back to session cookie on invalid/empty value
  if (rawAuthHeader !== undefined || rawApiKeyHeader !== undefined) {
    const authHeader = (rawAuthHeader || '').trim();
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const apiKeyPlain = ((rawApiKeyHeader || '').trim() || bearer).trim();

    if (!apiKeyPlain) {
      return c.json({ ok: false, error: 'Invalid API authentication header' }, 401);
    }

    const startMs = Date.now();
    const clientIp = getClientIp(c);
    const keyHash = await sha256Hex(apiKeyPlain);
    const keyRow = await c.env.DB.prepare(
      `SELECT id, workspace_id, is_test, last_used_at, scopes_json, rate_limit_rpm, allowed_ips, enabled, expires_at
       FROM api_keys
       WHERE key_hash = ? AND revoked_at IS NULL`
    )
      .bind(keyHash)
      .first<ApiKeyLookupRow>();

    if (!keyRow) {
      return c.json({ ok: false, error: 'Invalid or revoked API key' }, 401);
    }

    const nowMs = Date.now();
    const lastUsedMs = keyRow.last_used_at ? Date.parse(keyRow.last_used_at) : NaN;
    const shouldUpdateLastUsed =
      !keyRow.last_used_at ||
      !Number.isFinite(lastUsedMs) ||
      nowMs - lastUsedMs >= API_KEY_LAST_USED_THROTTLE_MS;

    // 1. Paused check
    if (keyRow.enabled !== null && keyRow.enabled !== 1) {
      await scheduleApiKeyTelemetry(c, {
        workspaceId: keyRow.workspace_id,
        apiKeyId: keyRow.id,
        clientIp,
        statusCode: 403,
        latencyMs: Date.now() - startMs,
        errorCode: 'API_KEY_PAUSED',
        updateLastUsed: shouldUpdateLastUsed,
      });
      return c.json(
        { ok: false, error: 'API key is paused', code: 'API_KEY_PAUSED' },
        403
      );
    }

    // 2. Expiration check
    if (keyRow.expires_at && Date.parse(keyRow.expires_at) <= nowMs) {
      await scheduleApiKeyTelemetry(c, {
        workspaceId: keyRow.workspace_id,
        apiKeyId: keyRow.id,
        clientIp,
        statusCode: 401,
        latencyMs: Date.now() - startMs,
        errorCode: 'API_KEY_EXPIRED',
        updateLastUsed: shouldUpdateLastUsed,
      });
      return c.json(
        { ok: false, error: 'API key has expired', code: 'API_KEY_EXPIRED' },
        401
      );
    }

    // 3. IP Allowlist check
    const allowedIps = parseJsonStringArray(keyRow.allowed_ips);
    if (allowedIps.length > 0 && !isIpAllowed(clientIp, allowedIps)) {
      await scheduleApiKeyTelemetry(c, {
        workspaceId: keyRow.workspace_id,
        apiKeyId: keyRow.id,
        clientIp,
        statusCode: 403,
        latencyMs: Date.now() - startMs,
        errorCode: 'API_KEY_IP_DENIED',
        updateLastUsed: shouldUpdateLastUsed,
      });
      return c.json(
        {
          ok: false,
          error: 'Client IP is not allowed for this API key',
          code: 'API_KEY_IP_DENIED',
        },
        403
      );
    }

    // 4. Per-key rate limit (zero D1 write sliding window)
    const rawRpm = Number(keyRow.rate_limit_rpm ?? 120);
    const rpm = Number.isFinite(rawRpm) ? Math.max(10, Math.min(600, Math.trunc(rawRpm))) : 120;
    const rl = checkLocalRateLimit(c.env.DB, `apikey_rpm:${keyRow.id}`, rpm, 60_000, nowMs);
    c.header('X-RateLimit-Limit', String(rpm));
    c.header('X-RateLimit-Remaining', String(rl.remaining));

    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      await scheduleApiKeyTelemetry(c, {
        workspaceId: keyRow.workspace_id,
        apiKeyId: keyRow.id,
        clientIp,
        statusCode: 429,
        latencyMs: Date.now() - startMs,
        errorCode: 'API_KEY_RATE_LIMITED',
        updateLastUsed: shouldUpdateLastUsed,
      });
      return c.json(
        {
          ok: false,
          error: 'API key rate limit exceeded',
          code: 'API_KEY_RATE_LIMITED',
        },
        429
      );
    }

    // 5. Scopes hydration
    let scopes = normalizeApiScopes(parseJsonStringArray(keyRow.scopes_json));
    if (scopes.length === 0 && !keyRow.scopes_json) {
      scopes = ['*'];
    }

    c.set('workspaceId', keyRow.workspace_id);
    c.set('apiKeyId', keyRow.id);
    c.set('apiKeyScopes', scopes);
    c.set('apiKeyRateLimitRpm', rpm);
    c.set('isTestKey', keyRow.is_test === 1);

    await next();

    const statusCode = c.res.status;
    let errorCode: string | null = null;
    if (statusCode >= 400) {
      const cloned = await c.res
        .clone()
        .json()
        .catch(() => null) as { code?: unknown } | null;
      errorCode =
        typeof cloned?.code === 'string' ? cloned.code.slice(0, 64) : `HTTP_${statusCode}`;
    }

    await scheduleApiKeyTelemetry(c, {
      workspaceId: keyRow.workspace_id,
      apiKeyId: keyRow.id,
      clientIp,
      statusCode,
      latencyMs: Date.now() - startMs,
      errorCode,
      updateLastUsed: shouldUpdateLastUsed,
    });
    return;
  }

  const session = await resolveCookieSession(c);
  if (!session) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  c.set('workspaceId', session.workspace_id);
  c.set('userId', session.user_id);
  c.set('userEmail', session.email);
  c.set('userRole', session.role);
  c.set('isTestKey', false);
  await next();
}

export async function requireLiveAuth(
  c: Context<AppContextEnv>,
  next: Next
): Promise<Response | void> {
  if (c.get('isTestKey')) {
    return c.json(
      {
        ok: false,
        error: 'Sandbox API key (cm_test_) cannot access or modify live resources',
        code: 'SANDBOX_KEY_FORBIDDEN',
      },
      403
    );
  }
  await next();
}

export function requireScope(required: ApiKeyScope) {
  return async (c: Context<AppContextEnv>, next: Next): Promise<Response | void> => {
    if (!c.get('apiKeyId')) {
      await next();
      return;
    }
    const granted = c.get('apiKeyScopes') ?? [];
    if (!hasApiScope(granted, required)) {
      return c.json(
        {
          ok: false,
          error: `API key missing required scope: ${required}`,
          code: 'INSUFFICIENT_SCOPE',
          requiredScope: required,
        },
        403
      );
    }
    await next();
  };
}
