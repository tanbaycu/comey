import { resolve } from 'node:path';
import { verifyWebhookSignature } from '@comey/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { createTestD1Database } from './helpers/sqliteD1.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');

function setupSecurityEnv(webhookFetch?: typeof fetch) {
  const { d1 } = createTestD1Database(MIGRATIONS_DIR);
  const env: Env = {
    DB: d1,
    MASTER_ENCRYPTION_KEY: 'test_master_encryption_key_32_bytes!!',
    SESSION_SECRET: 'test_session_secret_32_bytes!!',
    INBOUND_EMAIL_DOMAIN: 'in.comey.test',
    PUBLIC_BASE_URL: 'https://pay.comey.test',
    ALLOW_PUBLIC_SIGNUP: 'true',
  };
  const app = createApp({ webhookFetch });
  return { env, app };
}

async function registerAndSetup(app: ReturnType<typeof createApp>, env: Env) {
  const reg = await app.fetch(
    new Request('https://pay.comey.test/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sec@shop.vn',
        password: 'Password123',
        name: 'Security Owner',
      }),
    }),
    env
  );
  const cookie = (reg.headers.get('set-cookie') || '').split(';')[0]!;

  const ba = await app.fetch(
    new Request('https://pay.comey.test/v1/bank-accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://pay.comey.test',
      },
      body: JSON.stringify({
        bankCode: 'CAKE',
        accountNumber: '0835117727',
        accountName: 'TRAN MINH TAN',
      }),
    }),
    env
  );
  const baJson = (await ba.json()) as { bankAccount: { id: string } };
  return { cookie, bankAccountId: baJson.bankAccount.id };
}

describe('Comey Cloud Security Hardening', () => {
  it('blocks SSRF internal/metadata URLs, non-Google Apps Script URLs, ReDoS regexes, and 3xx redirects', async () => {
    const { env, app } = setupSecurityEnv(async () => {
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://169.254.169.254/latest/meta-data' },
      });
    });
    const { cookie, bankAccountId } = await registerAndSetup(app, env);

    const ssrfTargets = [
      'http://127.0.0.1:8080/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.50/hook',
      'http://[::1]/hook',
      'https://user:pass@webhook.example.com/hook',
      'https://2130706433/hook',
    ];

    for (const badUrl of ssrfTargets) {
      const r = await app.fetch(
        new Request('https://pay.comey.test/v1/routing-rules', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId,
            name: 'SSRF Test',
            matchType: 'prefix',
            pattern: 'SHOP',
            webhookUrl: badUrl,
          }),
        }),
        env
      );
      expect(r.status).toBe(400);
    }

    // ReDoS nested quantifier rejected
    const redosResp = await app.fetch(
      new Request('https://pay.comey.test/v1/routing-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId,
          name: 'ReDoS',
          matchType: 'regex',
          pattern: '^(a+)+$',
          webhookUrl: 'https://merchant.example.com/hook',
        }),
      }),
      env
    );
    expect(redosResp.status).toBe(400);

    // Non-Google Apps Script URL rejected on bank account update
    const badAsResp = await app.fetch(
      new Request(`https://pay.comey.test/v1/bank-accounts/${bankAccountId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({ appsScriptUrl: 'https://evil.example.com/exec' }),
      }),
      env
    );
    expect(badAsResp.status).toBe(400);

    // Valid webhook rule whose server returns 302 redirect -> blocked during delivery
    await app.fetch(
      new Request('https://pay.comey.test/v1/routing-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId,
          name: 'Redirect Trap',
          matchType: 'prefix',
          pattern: 'TRAP',
          webhookUrl: 'https://trap.example.com/hook',
        }),
      }),
      env
    );

    const simResp = await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId,
          amount: 50000,
          content: 'TRAP1234',
        }),
      }),
      env
    );
    const simJson = (await simResp.json()) as {
      simulation: { deliveries: Array<{ status: string; error: string }> };
    };
    expect(simJson.simulation.deliveries[0]?.status).toBe('retrying');
    expect(simJson.simulation.deliveries[0]?.error).toContain('Redirect');
  }, 20_000);

  it('enforces CSRF guard, security headers, rate limiting, secret rotation, password change & audit logs', async () => {
    const deliveredHeaders: Array<{ sig: string; body: string }> = [];
    const { env, app } = setupSecurityEnv(async (_input, init) => {
      const hdrs = init?.headers as Record<string, string>;
      deliveredHeaders.push({
        sig: hdrs['X-Comey-Signature'] || '',
        body: String(init?.body || ''),
      });
      return new Response('ok', { status: 200 });
    });

    const { cookie, bankAccountId } = await registerAndSetup(app, env);

    // Check security headers on /v1/*
    const meResp = await app.fetch(
      new Request('https://pay.comey.test/v1/auth/me', { headers: { Cookie: cookie } }),
      env
    );
    expect(meResp.headers.get('x-content-type-options')).toBe('nosniff');
    expect(meResp.headers.get('x-frame-options')).toBe('DENY');
    expect(meResp.headers.get('cache-control')).toBe('no-store');

    // CSRF cross-site Origin with cookie blocked (403)
    const csrfResp = await app.fetch(
      new Request('https://pay.comey.test/v1/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://evil-site.example',
        },
        body: JSON.stringify({ name: 'Steal Key' }),
      }),
      env
    );
    expect(csrfResp.status).toBe(403);

    // Routing rule secret rotation changes HMAC signing key immediately
    const rrResp = await app.fetch(
      new Request('https://pay.comey.test/v1/routing-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId,
          name: 'Rotate Test',
          matchType: 'prefix',
          pattern: 'ROT',
          webhookUrl: 'https://merchant.example.com/wh',
        }),
      }),
      env
    );
    const rrJson = (await rrResp.json()) as {
      routingRule: { id: string };
      webhookSecret: string;
    };
    const oldSecret = rrJson.webhookSecret;

    const rotResp = await app.fetch(
      new Request(
        `https://pay.comey.test/v1/routing-rules/${rrJson.routingRule.id}/rotate-secret`,
        {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://pay.comey.test' },
        }
      ),
      env
    );
    expect(rotResp.status).toBe(200);
    const rotJson = (await rotResp.json()) as { webhookSecret: string };
    const newSecret = rotJson.webhookSecret;
    expect(newSecret).not.toBe(oldSecret);

    await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({ bankAccountId, amount: 75000, content: 'ROT9988' }),
      }),
      env
    );

    const lastDlv = deliveredHeaders[deliveredHeaders.length - 1]!;
    expect((await verifyWebhookSignature(lastDlv.body, lastDlv.sig, newSecret)).valid).toBe(true);
    expect((await verifyWebhookSignature(lastDlv.body, lastDlv.sig, oldSecret)).valid).toBe(false);

    // Checkout /check cooldown (429 within 5s)
    const sessResp = await app.fetch(
      new Request('https://pay.comey.test/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({ bankAccountId, orderCode: 'CHK111', amount: 50000 }),
      }),
      env
    );
    const shortId = ((await sessResp.json()) as { session: { shortId: string } }).session
      .shortId;

    const chk1 = await app.fetch(
      new Request(`https://pay.comey.test/api/checkout/${shortId}/check`, {
        method: 'POST',
      }),
      env
    );
    expect(chk1.status).toBe(200);

    const chk2 = await app.fetch(
      new Request(`https://pay.comey.test/api/checkout/${shortId}/check`, {
        method: 'POST',
      }),
      env
    );
    expect(chk2.status).toBe(429);

    // Change password revokes old session cookie and rotates to a new cookie
    const pwResp = await app.fetch(
      new Request('https://pay.comey.test/v1/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          currentPassword: 'Password123',
          newPassword: 'NewPassword456',
        }),
      }),
      env
    );
    expect(pwResp.status).toBe(200);
    const newCookie = (pwResp.headers.get('set-cookie') || '').split(';')[0]!;

    // Old cookie is now rejected
    const oldMe = await app.fetch(
      new Request('https://pay.comey.test/v1/auth/me', { headers: { Cookie: cookie } }),
      env
    );
    expect(oldMe.status).toBe(401);

    // Security summary & audit logs work with new cookie
    const sumResp = await app.fetch(
      new Request('https://pay.comey.test/v1/security/summary', {
        headers: { Cookie: newCookie },
      }),
      env
    );
    expect(sumResp.status).toBe(200);
    const sumJson = (await sumResp.json()) as { summary: { recentAuditCount: number } };
    expect(sumJson.summary.recentAuditCount).toBeGreaterThanOrEqual(4);

    // Rate limit login after 10 attempts -> 429
    for (let i = 0; i < 10; i++) {
      await app.fetch(
        new Request('https://pay.comey.test/v1/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '198.51.100.77',
          },
          body: JSON.stringify({ email: 'sec@shop.vn', password: 'WrongPassword1' }),
        }),
        env
      );
    }
    const rlLogin = await app.fetch(
      new Request('https://pay.comey.test/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '198.51.100.77',
        },
        body: JSON.stringify({ email: 'sec@shop.vn', password: 'NewPassword456' }),
      }),
      env
    );
    expect(rlLogin.status).toBe(429);
    expect(rlLogin.headers.get('retry-after')).toBeTruthy();
  }, 20_000);
});
