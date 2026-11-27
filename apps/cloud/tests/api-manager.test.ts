import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { checkRateLimit } from '../src/middleware/rateLimit.js';
import { runScheduledMaintenance } from '../src/services/cron.js';
import { createTestD1Database } from './helpers/sqliteD1.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');
const ORIGIN = 'https://pay.comey.test';

function setupEnv() {
  const { d1, rawDb } = createTestD1Database(MIGRATIONS_DIR);
  const env: Env = {
    DB: d1,
    MASTER_ENCRYPTION_KEY: 'test_master_encryption_key_32_bytes!!',
    SESSION_SECRET: 'test_session_secret_32_bytes!!',
    INBOUND_EMAIL_DOMAIN: 'in.comey.test',
    PUBLIC_BASE_URL: ORIGIN,
    ALLOW_PUBLIC_SIGNUP: 'true',
  };
  const app = createApp();
  return { env, app, rawDb };
}

async function registerOwnerAndAccount(app: ReturnType<typeof createApp>, env: Env) {
  const reg = await app.fetch(
    new Request(`${ORIGIN}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'apimgr@comey.vn',
        password: 'Password123!',
        name: 'API Owner',
        workspaceName: 'API Mgr Shop',
      }),
    }),
    env
  );
  expect(reg.status).toBe(201);
  const cookie = (reg.headers.get('set-cookie') || '').split(';')[0]!;

  const acc = await app.fetch(
    new Request(`${ORIGIN}/v1/bank-accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        bankCode: 'CAKE',
        accountNumber: '0909555666',
        accountName: 'API OWNER',
      }),
    }),
    env
  );
  expect(acc.status).toBe(201);
  const accJson = (await acc.json()) as { bankAccount: { id: string } };
  return { cookie, accountId: accJson.bankAccount.id };
}

describe('API Manager: RBAC Scopes, Guardrails, Rotation, Telemetry & OpenAPI', () => {
  it(
    'enforces granular RBAC scopes, rejects invalid scopes, and blocks even wildcard API keys from managing /v1/api-keys',
    async () => {
      const { env, app } = setupEnv();
      const { cookie, accountId } = await registerOwnerAndAccount(app, env);

      // Reject unknown scope
      const invalidResp = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
          body: JSON.stringify({
            name: 'Invalid Scope Key',
            scopes: ['transactions:read', 'admin:super'],
          }),
        }),
        env
      );
      expect(invalidResp.status).toBe(400);

      // Create read-only transactions key
      const txOnlyResp = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
          body: JSON.stringify({
            name: 'Reporter Key',
            scopes: ['transactions:read'],
          }),
        }),
        env
      );
      expect(txOnlyResp.status).toBe(201);
      const txOnlyJson = (await txOnlyResp.json()) as {
        apiKey: { id: string; plaintextKey: string; scopes: string[] };
      };
      expect(txOnlyJson.apiKey.scopes).toEqual(['transactions:read']);
      const txKey = txOnlyJson.apiKey.plaintextKey;

      // Allowed route succeeds
      const listTx = await app.fetch(
        new Request(`${ORIGIN}/v1/transactions`, {
          headers: { Authorization: `Bearer ${txKey}` },
        }),
        env
      );
      expect(listTx.status).toBe(200);

      // Disallowed routes return 403 INSUFFICIENT_SCOPE
      const createSession = await app.fetch(
        new Request(`${ORIGIN}/v1/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${txKey}`,
          },
          body: JSON.stringify({
            bankAccountId: accountId,
            orderCode: 'UNAUTH1',
            amount: 50000,
          }),
        }),
        env
      );
      expect(createSession.status).toBe(403);
      const createSessionJson = (await createSession.json()) as {
        code: string;
        requiredScope: string;
      };
      expect(createSessionJson.code).toBe('INSUFFICIENT_SCOPE');
      expect(createSessionJson.requiredScope).toBe('sessions:write');

      const listAccounts = await app.fetch(
        new Request(`${ORIGIN}/v1/bank-accounts`, {
          headers: { Authorization: `Bearer ${txKey}` },
        }),
        env
      );
      expect(listAccounts.status).toBe(403);

      // Even wildcard API key cannot manage /v1/api-keys (session auth boundary)
      const adminKeyResp = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
          body: JSON.stringify({ name: 'Wildcard Key', scopes: ['*'] }),
        }),
        env
      );
      const adminKeyJson = (await adminKeyResp.json()) as { apiKey: { plaintextKey: string } };
      const apiMgmtAttempt = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys`, {
          headers: { Authorization: `Bearer ${adminKeyJson.apiKey.plaintextKey}` },
        }),
        env
      );
      expect(apiMgmtAttempt.status).toBe(401);
    },
    20_000
  );

  it(
    'enforces pause/resume, IP allowlist CIDR, expiration, per-key RPM limit, rotation, and request telemetry',
    async () => {
      const { env, app, rawDb } = setupEnv();
      const { cookie } = await registerOwnerAndAccount(app, env);

      // Create key restricted by IP CIDR, RPM=10, and 30d expiry
      const createResp = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
          body: JSON.stringify({
            name: 'Bot Locked',
            description: 'VPS Singapore only',
            scopes: ['transactions:read', 'sessions:read'],
            rateLimitRpm: 10,
            allowedIps: '203.0.113.0/24',
            expiresInDays: 30,
          }),
        }),
        env
      );
      expect(createResp.status).toBe(201);
      const created = (await createResp.json()) as {
        apiKey: { id: string; plaintextKey: string; keyPrefix: string; expiresAt: string };
      };
      let activePlainKey = created.apiKey.plaintextKey;

      // 1. Disallowed IP -> 403 API_KEY_IP_DENIED
      const deniedIpResp = await app.fetch(
        new Request(`${ORIGIN}/v1/transactions`, {
          headers: {
            Authorization: `Bearer ${activePlainKey}`,
            'CF-Connecting-IP': '198.51.100.25',
          },
        }),
        env
      );
      expect(deniedIpResp.status).toBe(403);
      expect(((await deniedIpResp.json()) as { code: string }).code).toBe('API_KEY_IP_DENIED');

      // 2. Allowed CIDR IP -> 200 with X-RateLimit headers
      const okIpResp = await app.fetch(
        new Request(`${ORIGIN}/v1/transactions`, {
          headers: {
            Authorization: `Bearer ${activePlainKey}`,
            'CF-Connecting-IP': '203.0.113.42',
          },
        }),
        env
      );
      expect(okIpResp.status).toBe(200);
      expect(okIpResp.headers.get('x-ratelimit-limit')).toBe('10');

      // 3. Pause key -> 403 API_KEY_PAUSED, then Resume -> 200
      const pauseResp = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys/${created.apiKey.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
          body: JSON.stringify({ enabled: false }),
        }),
        env
      );
      expect(pauseResp.status).toBe(200);

      const pausedCall = await app.fetch(
        new Request(`${ORIGIN}/v1/transactions`, {
          headers: {
            Authorization: `Bearer ${activePlainKey}`,
            'CF-Connecting-IP': '203.0.113.42',
          },
        }),
        env
      );
      expect(pausedCall.status).toBe(403);
      expect(((await pausedCall.json()) as { code: string }).code).toBe('API_KEY_PAUSED');

      await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys/${created.apiKey.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
          body: JSON.stringify({ enabled: true }),
        }),
        env
      );

      // 4. Rotate key -> old key rejected (401), new key works & inherits scopes/RPM/IP
      const rotateResp = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys/${created.apiKey.id}/rotate`, {
          method: 'POST',
          headers: { Cookie: cookie, Origin: ORIGIN },
        }),
        env
      );
      expect(rotateResp.status).toBe(200);
      const rotatedJson = (await rotateResp.json()) as {
        apiKey: { plaintextKey: string; keyPrefix: string };
      };
      expect(rotatedJson.apiKey.plaintextKey).not.toBe(activePlainKey);

      const oldKeyResp = await app.fetch(
        new Request(`${ORIGIN}/v1/transactions`, {
          headers: {
            Authorization: `Bearer ${activePlainKey}`,
            'CF-Connecting-IP': '203.0.113.42',
          },
        }),
        env
      );
      expect(oldKeyResp.status).toBe(401);

      activePlainKey = rotatedJson.apiKey.plaintextKey;

      // 5. Burn remaining RPM quota (rpm=10; 1 allowed call + 9 more = 10, 11th+ -> 429 API_KEY_RATE_LIMITED)
      let hitRateLimit = false;
      for (let i = 0; i < 12; i++) {
        const res = await app.fetch(
          new Request(`${ORIGIN}/v1/transactions`, {
            headers: {
              Authorization: `Bearer ${activePlainKey}`,
              'CF-Connecting-IP': '203.0.113.42',
            },
          }),
          env
        );
        if (res.status === 429) {
          hitRateLimit = true;
          expect(res.headers.get('retry-after')).toBeTruthy();
          expect(((await res.json()) as { code: string }).code).toBe('API_KEY_RATE_LIMITED');
          break;
        }
      }
      expect(hitRateLimit).toBe(true);

      // 6. Inspect telemetry summary & logs
      const logsResp = await app.fetch(
        new Request(`${ORIGIN}/v1/api-keys/logs?apiKeyId=${created.apiKey.id}`, {
          headers: { Cookie: cookie },
        }),
        env
      );
      expect(logsResp.status).toBe(200);
      const logsJson = (await logsResp.json()) as {
        logs: Array<{ statusCode: number; errorCode: string | null }>;
        summary: {
          totalRequests24h: number;
          errorRequests24h: number;
          rateLimited24h: number;
        };
      };
      expect(logsJson.summary.totalRequests24h).toBeGreaterThanOrEqual(11);
      expect(logsJson.summary.rateLimited24h).toBeGreaterThanOrEqual(1);
      expect(logsJson.summary.errorRequests24h).toBeGreaterThanOrEqual(3);

      // 7. Expiration check
      rawDb
        .prepare(`UPDATE api_keys SET expires_at = ? WHERE id = ?`)
        .run('2020-01-01T00:00:00.000Z', created.apiKey.id);
      const expiredResp = await app.fetch(
        new Request(`${ORIGIN}/v1/transactions`, {
          headers: {
            Authorization: `Bearer ${activePlainKey}`,
            'CF-Connecting-IP': '203.0.113.42',
          },
        }),
        env
      );
      expect(expiredResp.status).toBe(401);
      expect(((await expiredResp.json()) as { code: string }).code).toBe('API_KEY_EXPIRED');

      // 8. Cron purges logs older than 7 days
      rawDb
        .prepare(`UPDATE api_request_logs SET created_at = ? WHERE api_key_id = ?`)
        .run('2020-01-01T00:00:00.000Z', created.apiKey.id);
      await runScheduledMaintenance(env, { forceCleanup: true });
      const purgedCount = rawDb
        .prepare(`SELECT COUNT(*) AS cnt FROM api_request_logs WHERE api_key_id = ?`)
        .get(created.apiKey.id) as { cnt: number };
      expect(Number(purgedCount.cnt)).toBe(0);

      // 9. OpenAPI 3.1.0 endpoint
      const specResp = await app.fetch(new Request(`${ORIGIN}/v1/openapi.json`), env);
      expect(specResp.status).toBe(200);
      const specJson = (await specResp.json()) as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      expect(specJson.openapi).toBe('3.1.0');
      expect(specJson.paths['/v1/sessions']).toBeDefined();
    },
    20_000
  );

  it('short-circuits repeated rate-limit bursts in RAM without burning D1 writes', async () => {
    const { d1 } = createTestD1Database(MIGRATIONS_DIR);
    let d1PrepareCalls = 0;
    const wrappedDb = {
      prepare(sql: string) {
        d1PrepareCalls += 1;
        return d1.prepare(sql);
      },
      batch: d1.batch.bind(d1),
      exec: d1.exec.bind(d1),
      dump: d1.dump.bind(d1),
      withSession: d1.withSession.bind(d1),
    } as unknown as D1Database;

    const r1 = await checkRateLimit(wrappedDb, 'burst:1.2.3.4', 2, 60, 10_000);
    const r2 = await checkRateLimit(wrappedDb, 'burst:1.2.3.4', 2, 60, 10_100);
    const r3 = await checkRateLimit(wrappedDb, 'burst:1.2.3.4', 2, 60, 10_200);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(d1PrepareCalls).toBe(2);

    // After hitting maxHits=2, subsequent bursts within the same window hit RAM cache with 0 D1 calls
    const r4 = await checkRateLimit(wrappedDb, 'burst:1.2.3.4', 2, 60, 10_300);
    const r5 = await checkRateLimit(wrappedDb, 'burst:1.2.3.4', 2, 60, 10_400);
    expect(r4.allowed).toBe(false);
    expect(r5.allowed).toBe(false);
    expect(d1PrepareCalls).toBe(2);

    // Once the 60s window expires, request cleanly resets in D1
    const rAfter = await checkRateLimit(wrappedDb, 'burst:1.2.3.4', 2, 60, 75_000);
    expect(rAfter.allowed).toBe(true);
    expect(d1PrepareCalls).toBe(3);
  });
});
