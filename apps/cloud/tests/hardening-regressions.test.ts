import { resolve } from 'node:path';
import { verifyWebhookSignature } from '@comey/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { handleInboundEmail } from '../src/handlers/emailWorker.js';
import {
  SANDBOX_WEBHOOK_URL,
  validateAppsScriptUrl,
  validateSafeOutboundUrl,
  validateSafeRegexPattern,
} from '../src/security/urlGuard.js';
import { runScheduledMaintenance } from '../src/services/cron.js';
import { createTestD1Database } from './helpers/sqliteD1.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');
const ORIGIN = 'https://pay.comey.test';

function makeRawStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function createMockCtx(): { ctx: ExecutionContext; waitPromises: Promise<unknown>[] } {
  const waitPromises: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    waitUntil(p: Promise<unknown>) {
      waitPromises.push(p);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, waitPromises };
}

function setupEnv(
  overrides?: Partial<Env>,
  webhookFetch?: typeof fetch
) {
  const { d1, rawDb } = createTestD1Database(MIGRATIONS_DIR);
  const env: Env = {
    DB: d1,
    MASTER_ENCRYPTION_KEY: 'test_master_encryption_key_32_bytes!!',
    SESSION_SECRET: 'test_session_secret_32_bytes!!',
    INBOUND_EMAIL_DOMAIN: 'in.comey.test',
    PUBLIC_BASE_URL: ORIGIN,
    ALLOW_PUBLIC_SIGNUP: 'true',
    ...overrides,
  };
  const app = createApp({ webhookFetch });
  return { env, app, rawDb };
}

async function registerUser(
  app: ReturnType<typeof createApp>,
  env: Env,
  email: string,
  password = 'Password123!'
) {
  const res = await app.fetch(
    new Request(`${ORIGIN}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: email.split('@')[0] }),
    }),
    env
  );
  expect(res.status).toBe(201);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0]!;
  return { cookie };
}

async function createBankAccount(
  app: ReturnType<typeof createApp>,
  env: Env,
  cookie: string,
  accountNumber: string,
  accountName = 'SHOP OWNER'
) {
  const res = await app.fetch(
    new Request(`${ORIGIN}/v1/bank-accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        bankCode: 'CAKE',
        accountNumber,
        accountName,
        strictAuth: true,
      }),
    }),
    env
  );
  expect(res.status).toBe(201);
  return (await res.json()) as {
    bankAccount: { id: string; inboundEmail: string };
    appsScriptToken: string;
  };
}

describe('Comey Cloud Security, Isolation & Performance Regressions', () => {
  it('CRIT-1: blocks forged Authentication-Results & untrusted ARC while allowing genuine Gmail auto-forwarding', async () => {
    const { env, app } = setupEnv();
    const { cookie } = await registerUser(app, env, 'crit1@shop.vn');
    const { bankAccount } = await createBankAccount(app, env, cookie, '0835117727');

    // 1. Dual-header injection: genuine top dkim=fail + forged lower dkim=pass -> MUST quarantine
    const forgedMime = [
      'Authentication-Results: mx.cloudflare.net; dkim=fail header.d=cake.vn; spf=fail',
      'Authentication-Results: forged.attacker.mx; dkim=pass header.d=cake.vn; spf=pass',
      'From: "Cake by VPBank" <no-reply@cake.vn>',
      `To: ${bankAccount.inboundEmail}`,
      'Subject: Thông báo biến động số dư',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Tài khoản nhận: 0835117727',
      'Số tiền: +1.000.000 đ',
      'Mã giao dịch: FTFORGED1',
      'Nội dung giao dịch: ORDER1',
    ].join('\r\n');

    const { ctx: c1 } = createMockCtx();
    const res1 = await handleInboundEmail(
      {
        from: 'attacker@evil.example',
        to: bankAccount.inboundEmail,
        raw: makeRawStream(forgedMime),
        setReject: () => {},
      },
      env,
      c1
    );
    expect(res1?.status).toBe('quarantined');

    // 2. Untrusted ARC chain forgery (arc=pass signed by evil.com, not google.com) -> MUST quarantine
    const badArcMime = [
      'Authentication-Results: mx.cloudflare.net; dkim=fail; arc=pass; spf=pass',
      'ARC-Seal: i=1; a=rsa-sha256; t=1700000000; cv=none; d=evil.example; s=s1; b=abc',
      'ARC-Authentication-Results: i=1; mx.evil.example; dkim=pass header.d=cake.vn; spf=pass',
      'From: "Cake by VPBank" <no-reply@cake.vn>',
      `To: ${bankAccount.inboundEmail}`,
      'Subject: Thông báo biến động số dư',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Tài khoản nhận: 0835117727',
      'Số tiền: +1.000.000 đ',
      'Mã giao dịch: FTARCEVIL',
      'Nội dung giao dịch: ORDER2',
    ].join('\r\n');

    const { ctx: c2 } = createMockCtx();
    const res2 = await handleInboundEmail(
      {
        from: 'evil@evil.example',
        to: bankAccount.inboundEmail,
        raw: makeRawStream(badArcMime),
        setReject: () => {},
      },
      env,
      c2
    );
    expect(res2?.status).toBe('quarantined');

    // 3. Genuine Gmail auto-forwarding: SMTP envelope is user+caf_=@gmail.com while MIME From is no-reply@cake.vn
    //    emailWorker MUST NOT overwrite MIME From with message.from!
    const gmailFwdMime = [
      'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=cake.vn; arc=pass; spf=pass',
      'ARC-Seal: i=1; a=rsa-sha256; t=1700000000; cv=none; d=google.com; s=arc-20240605; b=xyz',
      'ARC-Authentication-Results: i=1; mx.google.com; dkim=pass header.d=cake.vn; spf=pass',
      'From: "Cake by VPBank" <no-reply@cake.vn>',
      `To: ${bankAccount.inboundEmail}`,
      'Subject: Thông báo biến động số dư',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Tài khoản nhận: 0835117727',
      'Số tiền: +250.000 đ',
      'Mã giao dịch: FTGMAILFWD1',
      'Ngày giờ giao dịch: 26/11/2026 11:00:00',
      'Nội dung giao dịch: GMAILFWD100',
    ].join('\r\n');

    const { ctx: c3 } = createMockCtx();
    const res3 = await handleInboundEmail(
      {
        from: 'merchant+caf_=in_cake_abc=in.comey.test@gmail.com',
        to: bankAccount.inboundEmail,
        raw: makeRawStream(gmailFwdMime),
        setReject: () => {},
      },
      env,
      c3
    );
    expect(res3?.status).toBe('parsed');
    if (res3?.status === 'parsed') {
      expect(res3.transaction.amount).toBe(250000);
      expect(res3.transaction.auth.status).toBe('verified');
    }
  }, 20_000);

  it('CRIT-2 & SEC-H3 & MED-3: blocks IPv4-mapped IPv6, NAT64, trailing-dot SSRF, non-standard ports, ReDoS bypasses, and sandbox returnUrl', async () => {
    const ssrfUrls = [
      'http://[::ffff:127.0.0.1]/hook',
      'http://[::ffff:169.254.169.254]/latest/meta-data',
      'http://[::ffff:10.0.0.1]/hook',
      'http://[::ffff:192.168.1.1]/hook',
      'http://[::ffff:0:127.0.0.1]/hook',
      'http://[64:ff9b::127.0.0.1]/hook',
      'http://[::127.0.0.1]/hook',
      'http://[fec0::1]/hook',
      'http://[100::1]/hook',
      'http://[ff02::1]/hook',
      'http://[::]/hook',
      'http://[2002:7f00:1::]/hook',
      'http://[2002:a9fe:a9fe::]/hook',
      'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/hook',
      'http://[2001:db8::1]/hook',
      'http://198.18.0.1/hook',
      'http://198.19.255.254/hook',
      'http://localhost./hook',
      'http://sub.localhost./hook',
      'http://metadata.google.internal./computeMetadata/v1/',
      'http://service.local./hook',
      'https://merchant.example.com:6379/hook',
      'http://merchant.example.com:8080/hook',
      SANDBOX_WEBHOOK_URL, // blocked by default when allowSandbox is false
    ];

    for (const u of ssrfUrls) {
      expect(validateSafeOutboundUrl(u).ok, `expected blocked: ${u}`).toBe(false);
    }

    // Valid global IPv6 and standard HTTPS URLs remain allowed
    expect(validateSafeOutboundUrl('https://[2606:4700:4700::1111]/hook').ok).toBe(true);
    expect(validateSafeOutboundUrl('https://merchant.example.com/hook').ok).toBe(true);
    expect(validateSafeOutboundUrl(SANDBOX_WEBHOOK_URL, { allowSandbox: true }).ok).toBe(true);

    // Apps Script URL must reject explicit ports
    expect(validateAppsScriptUrl('https://script.google.com:8443/macros/s/abc/exec').ok).toBe(false);
    expect(validateAppsScriptUrl('https://script.google.com/macros/s/abc/exec').ok).toBe(true);

    // ReDoS bypass vectors rejected (incl. optional-in-repeated-group & polynomial chains)
    const badRegexes = [
      '((a)+)+',
      '(a{1,})+',
      '((a|aa))+',
      '(a?a)+$',
      '(a?a?a)+$',
      '((a?)a)+$',
      '(a{0,1}a)+$',
      'a+a+a+a+a+a+a+a+a+a+!$',
      '[\\s\\S]*a[\\s\\S]*a[\\s\\S]*a[\\s\\S]*a[\\s\\S]*a[\\s\\S]*b',
      '.*.*.*.*.*.*!',
      '.+.+',
      '\\s*\\s*',
      '(a)\\1+',
      'a{100}',
    ];
    for (const pattern of badRegexes) {
      expect(validateSafeRegexPattern(pattern).ok, `expected ReDoS rejected: ${pattern}`).toBe(
        false
      );
    }

    // Valid order-code regexes still pass
    expect(validateSafeRegexPattern('^(SHOP|ORD)[-_]?\\d{4,10}$').ok).toBe(true);

    // MED-3 & MED-4 via POST /v1/sessions
    const { env, app } = setupEnv();
    const { cookie } = await registerUser(app, env, 'med34@shop.vn');
    const { bankAccount } = await createBankAccount(app, env, cookie, '0911223344');

    const badReturn = await app.fetch(
      new Request(`${ORIGIN}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          orderCode: 'RET1',
          amount: 50000,
          returnUrl: SANDBOX_WEBHOOK_URL,
        }),
      }),
      env
    );
    expect(badReturn.status).toBe(400);

    // MED-4: Huge ttlSeconds: 1e15 is clamped cleanly (201, NOT 500 RangeError) + UI-H2 bankAccountId present
    const hugeTtl = await app.fetch(
      new Request(`${ORIGIN}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          orderCode: 'TTLCLAMP1',
          amount: 50000,
          ttlSeconds: 1e15,
        }),
      }),
      env
    );
    expect(hugeTtl.status).toBe(201);
    const hugeTtlJson = (await hugeTtl.json()) as {
      session: { id: string; bankAccountId: string; expiresAt: string; createdAt: string };
    };
    expect(hugeTtlJson.session.bankAccountId).toBe(bankAccount.id);
    const deltaSec =
      (Date.parse(hugeTtlJson.session.expiresAt) - Date.parse(hugeTtlJson.session.createdAt)) /
      1000;
    expect(deltaSec).toBeLessThanOrEqual(86_400);
    expect(deltaSec).toBeGreaterThanOrEqual(86_390);

    // GET /v1/sessions & GET /v1/sessions/:id also return bankAccountId (UI-H2)
    const listSess = (await (
      await app.fetch(new Request(`${ORIGIN}/v1/sessions`, { headers: { Cookie: cookie } }), env)
    ).json()) as { sessions: Array<{ bankAccountId: string }> };
    expect(listSess.sessions[0]?.bankAccountId).toBe(bankAccount.id);
  }, 20_000);

  it('CRIT-3: isolates cm_test_ API keys from live resources and gates simulated external SePay/PayOS webhooks', async () => {
    const externalCalls: string[] = [];
    const { env, app } = setupEnv({}, async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      externalCalls.push(url);
      return new Response('ok', { status: 200 });
    });

    const { cookie } = await registerUser(app, env, 'crit3@shop.vn');
    const { bankAccount } = await createBankAccount(app, env, cookie, '0835117727');

    // Create a cm_test_ API key
    const testKeyRes = await app.fetch(
      new Request(`${ORIGIN}/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'Sandbox Key', isTest: true }),
      }),
      env
    );
    expect(testKeyRes.status).toBe(201);
    const testKey = ((await testKeyRes.json()) as { apiKey: { plaintextKey: string } }).apiKey
      .plaintextKey;
    expect(testKey.startsWith('cm_test_')).toBe(true);

    // Create a live SePay rule, live Comey rule, and sandbox rule via owner cookie
    await app.fetch(
      new Request(`${ORIGIN}/v1/routing-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          name: 'Live SePay',
          matchType: 'all',
          priority: 10,
          payloadFormat: 'sepay',
          webhookUrl: 'https://sepay-live.example.com/hook',
          stopOnMatch: false,
        }),
      }),
      env
    );
    await app.fetch(
      new Request(`${ORIGIN}/v1/routing-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          name: 'Sandbox Inbox',
          matchType: 'all',
          priority: 20,
          payloadFormat: 'sepay',
          webhookUrl: SANDBOX_WEBHOOK_URL,
          stopOnMatch: false,
        }),
      }),
      env
    );

    // Create a LIVE payment session (is_test = 0)
    const liveSessRes = await app.fetch(
      new Request(`${ORIGIN}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          orderCode: 'LIVE9001',
          amount: 100000,
        }),
      }),
      env
    );
    const liveSessId = ((await liveSessRes.json()) as { session: { id: string } }).session.id;

    // 1. cm_test_ CANNOT mutate bank accounts, routing rules, soundboxes, or live sessions (403)
    const testMutateBa = await app.fetch(
      new Request(`${ORIGIN}/v1/bank-accounts/${bankAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testKey}` },
        body: JSON.stringify({ strictAuth: false }),
      }),
      env
    );
    expect(testMutateBa.status).toBe(403);

    const testCreateRule = await app.fetch(
      new Request(`${ORIGIN}/v1/routing-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testKey}` },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          name: 'Hijack',
          matchType: 'all',
          webhookUrl: 'https://evil.example.com/hook',
        }),
      }),
      env
    );
    expect(testCreateRule.status).toBe(403);

    const testCreateSb = await app.fetch(
      new Request(`${ORIGIN}/v1/soundboxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testKey}` },
        body: JSON.stringify({ name: 'Test Loa' }),
      }),
      env
    );
    expect(testCreateSb.status).toBe(403);

    const testReadLiveSess = await app.fetch(
      new Request(`${ORIGIN}/v1/sessions/${liveSessId}`, {
        headers: { Authorization: `Bearer ${testKey}` },
      }),
      env
    );
    expect(testReadLiveSess.status).toBe(403);

    const testCancelLiveSess = await app.fetch(
      new Request(`${ORIGIN}/v1/sessions/${liveSessId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${testKey}` },
      }),
      env
    );
    expect(testCancelLiveSess.status).toBe(403);

    const testReadLiveTx = await app.fetch(
      new Request(`${ORIGIN}/v1/transactions?includeTest=false`, {
        headers: { Authorization: `Bearer ${testKey}` },
      }),
      env
    );
    expect(testReadLiveTx.status).toBe(403);

    // CRIT-3 residual: cm_test_ CANNOT read deliveries, quarantine, audit-logs, security/summary, or soundboxes
    for (const path of [
      '/v1/deliveries',
      '/v1/quarantine',
      '/v1/audit-logs',
      '/v1/security/summary',
      '/v1/soundboxes',
    ]) {
      const r = await app.fetch(
        new Request(`${ORIGIN}${path}`, {
          headers: { Authorization: `Bearer ${testKey}` },
        }),
        env
      );
      expect(r.status, `cm_test_ should get 403 on ${path}`).toBe(403);
    }

    // Create a live Soundbox to verify cm_test_ simulator does NOT trigger physical counter audio
    const liveSbRes = await app.fetch(
      new Request(`${ORIGIN}/v1/soundboxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ name: 'Live Counter Loa', bankAccountId: bankAccount.id }),
      }),
      env
    );
    expect(liveSbRes.status).toBe(201);
    const liveSbToken = ((await liveSbRes.json()) as { kioskToken: string }).kioskToken;

    // 2. cm_test_ CAN create a test session (is_test = 1) and settle it via simulator without settling LIVE9001 or calling external hooks
    const testSessRes = await app.fetch(
      new Request(`${ORIGIN}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testKey}` },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          orderCode: 'TEST7001',
          amount: 50000,
        }),
      }),
      env
    );
    expect(testSessRes.status).toBe(201);
    const testSessJson = (await testSessRes.json()) as {
      session: { id: string; isTest: boolean };
    };
    expect(testSessJson.session.isTest).toBe(true);

    // Attempt with cm_test_ to settle LIVE9001 (even trying allowLiveSessionMatch: true) -> MUST NOT settle LIVE9001
    const simLiveAttempt = await app.fetch(
      new Request(`${ORIGIN}/v1/simulator/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testKey}` },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          amount: 100000,
          content: 'LIVE9001',
          allowLiveSessionMatch: true,
          allowExternalWebhooks: true,
        }),
      }),
      env
    );
    expect(simLiveAttempt.status).toBe(200);
    expect(externalCalls).toHaveLength(0);

    const liveSessAfter = (await (
      await app.fetch(
        new Request(`${ORIGIN}/v1/sessions/${liveSessId}`, { headers: { Cookie: cookie } }),
        env
      )
    ).json()) as { session: { status: string } };
    expect(liveSessAfter.session.status).toBe('pending');

    // cm_test_ settles TEST7001 -> succeeds, ONLY delivers to SANDBOX_WEBHOOK_URL, 0 external calls
    const simTestOk = await app.fetch(
      new Request(`${ORIGIN}/v1/simulator/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testKey}` },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          amount: 50000,
          content: 'TEST7001',
        }),
      }),
      env
    );
    expect(simTestOk.status).toBe(200);
    const simTestJson = (await simTestOk.json()) as {
      simulation: { sessionAction: string; deliveries: Array<{ targetUrl: string }> };
    };
    expect(simTestJson.simulation.sessionAction).toBe('paid');
    expect(simTestJson.simulation.deliveries.every((d) => d.targetUrl === SANDBOX_WEBHOOK_URL)).toBe(
      true
    );
    expect(externalCalls).toHaveLength(0);

    // CRIT-3 residual: Live Soundbox MUST NOT receive cm_test_ simulated transfers
    const sbAfterTestKey = await app.fetch(
      new Request(`${ORIGIN}/api/soundbox/events`, {
        headers: { Authorization: `Bearer ${liveSbToken}` },
      }),
      env
    );
    expect(sbAfterTestKey.status).toBe(200);
    const sbAfterTestKeyJson = (await sbAfterTestKey.json()) as { events: unknown[] };
    expect(sbAfterTestKeyJson.events).toHaveLength(0);

    // 3. Owner cookie simulator WITHOUT allowExternalWebhooks: true MUST block live SePay external webhook
    const ownerSimDefault = await app.fetch(
      new Request(`${ORIGIN}/v1/simulator/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          amount: 100000,
          content: 'LIVE9001',
        }),
      }),
      env
    );
    expect(ownerSimDefault.status).toBe(200);
    expect(externalCalls).toHaveLength(0);
    // Owner Dashboard Test Paid still settled LIVE9001
    const liveSessPaid = (await (
      await app.fetch(
        new Request(`${ORIGIN}/v1/sessions/${liveSessId}`, { headers: { Cookie: cookie } }),
        env
      )
    ).json()) as { session: { status: string } };
    expect(liveSessPaid.session.status).toBe('paid');
  }, 20_000);

  it('SEC-H2: fails closed on CSRF (missing Origin/Sec-Fetch-Site, same-site, text/plain, dummy auth headers) and blocks auth fallback', async () => {
    const { env, app } = setupEnv();
    const { cookie } = await registerUser(app, env, 'csrf@shop.vn');

    // 1. Missing Origin and missing Sec-Fetch-Site -> 403
    const noHeaders = await app.fetch(
      new Request(`${ORIGIN}/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'NoOrigin' }),
      }),
      env
    );
    expect(noHeaders.status).toBe(403);

    // 2. Sec-Fetch-Site: same-site without matching Origin -> 403
    const sameSiteOnly = await app.fetch(
      new Request(`${ORIGIN}/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'Sec-Fetch-Site': 'same-site',
        },
        body: JSON.stringify({ name: 'SameSite' }),
      }),
      env
    );
    expect(sameSiteOnly.status).toBe(403);

    // 3. Content-Type: text/plain even with same-origin Origin -> 415
    const textPlain = await app.fetch(
      new Request(`${ORIGIN}/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Cookie: cookie,
          Origin: ORIGIN,
        },
        body: JSON.stringify({ name: 'TextPlain' }),
      }),
      env
    );
    expect(textPlain.status).toBe(415);

    // 4. Dummy X-Comey-Ingest-Secret / Authorization: Basic dummy NEVER bypasses CSRF
    const dummySecret = await app.fetch(
      new Request(`${ORIGIN}/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
          'X-Comey-Ingest-Secret': 'dummy',
        },
        body: JSON.stringify({ name: 'Bypass1' }),
      }),
      env
    );
    expect(dummySecret.status).toBe(403);

    const dummyAuth = await app.fetch(
      new Request(`${ORIGIN}/v1/routing-rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
          Authorization: 'Basic dummy',
        },
        body: JSON.stringify({ name: 'Bypass2' }),
      }),
      env
    );
    expect(dummyAuth.status).toBe(403);

    // 5. requireWorkspaceAuth NEVER falls back to session cookie if Authorization header is invalid (even on GET)
    const badAuthGet = await app.fetch(
      new Request(`${ORIGIN}/v1/bank-accounts`, {
        headers: {
          Cookie: cookie,
          Authorization: 'Basic invalid',
        },
      }),
      env
    );
    expect(badAuthGet.status).toBe(401);

    // 6. Sec-Fetch-Site: same-origin without Origin header IS allowed for JSON
    const sameOriginFetchSite = await app.fetch(
      new Request(`${ORIGIN}/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify({ name: 'ValidFetchSite' }),
      }),
      env
    );
    expect(sameOriginFetchSite.status).toBe(201);
  }, 20_000);

  it('SEC-H4 & PERF-H1: enforces Soundbox scope isolation on account delete, hashed tokens, Bearer auth, clamped since, uniform 404 & last_seen_at throttle', async () => {
    const { env, app, rawDb } = setupEnv();
    const { cookie } = await registerUser(app, env, 'sbsec@shop.vn');
    const acc1 = await createBankAccount(app, env, cookie, '0901111111', 'CASHIER');
    const acc2 = await createBankAccount(app, env, cookie, '0902222222', 'TREASURY');

    const sbRes = await app.fetch(
      new Request(`${ORIGIN}/v1/soundboxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          name: 'Secret Cashier Loa',
          bankAccountId: acc1.bankAccount.id,
          voiceLang: 'en-US',
        }),
      }),
      env
    );
    expect(sbRes.status).toBe(201);
    const sbJson = (await sbRes.json()) as {
      soundbox: { id: string; scope: string };
      kioskToken: string;
    };
    expect(sbJson.soundbox.scope).toBe('account');

    // Verify plaintext token is NOT stored in DB
    const dbRow = rawDb
      .prepare(`SELECT kiosk_token, kiosk_token_hash FROM soundboxes WHERE id = ?`)
      .get(sbJson.soundbox.id) as { kiosk_token: string; kiosk_token_hash: string };
    expect(dbRow.kiosk_token).not.toBe(sbJson.kioskToken);
    expect(dbRow.kiosk_token_hash).toMatch(/^[0-9a-f]{64}$/);

    // Kiosk HTML has CSP, Cache-Control: no-store, en-US voice matching, and (TEST) initial render fix
    const kioskRes = await app.fetch(
      new Request(`${ORIGIN}/soundbox/${sbJson.kioskToken}`),
      env
    );
    expect(kioskRes.status).toBe(200);
    expect(kioskRes.headers.get('cache-control')).toBe('no-store');
    expect(kioskRes.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const kioskHtml = await kioskRes.text();
    expect(kioskHtml).toContain("langPrefix");
    expect(kioskHtml).toContain("lastEv.isTest ? ' (TEST)' : ''");

    // Seed an old transaction (> 48h ago) on acc1 and a recent treasury transaction on acc2
    const oldIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    rawDb
      .prepare(
        `INSERT INTO transactions (
          id, workspace_id, bank_account_id, idempotency_key, bank_code, bank_bin, bank_tx_id,
          account_number, direction, amount, currency, content, occurred_at, source, raw_hash,
          auth_status, is_test, created_at
        ) SELECT 'tx_old_1', workspace_id, id, 'cake_OLD1', 'CAKE', '546034', 'OLD1',
                 '0901111111', 'in', 500000, 'VND', 'OLD HISTORICAL TX', ?, 'simulator', 'h1',
                 'simulated', 0, ?
          FROM bank_accounts WHERE id = ?`
      )
      .run(oldIso, oldIso, acc1.bankAccount.id);

    await app.fetch(
      new Request(`${ORIGIN}/v1/simulator/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: acc2.bankAccount.id,
          amount: 99000000,
          content: 'TREASURY SECRET 99M',
        }),
      }),
      env
    );

    // Polling via Authorization: Bearer with ?since=1970-01-01T00:00:00Z AND non-canonical Date.parse strings
    // MUST normalize to canonical ISO UTC and clamp to 24h (never returns 48h old tx)
    for (const bypassSince of [
      '1970-01-01T00:00:00Z',
      '+002026-11-26T00:00:00Z',
      '11/26/2026',
    ]) {
      const bearerPoll = await app.fetch(
        new Request(
          `${ORIGIN}/api/soundbox/events?since=${encodeURIComponent(bypassSince)}`,
          {
            headers: { Authorization: `Bearer ${sbJson.kioskToken}` },
          }
        ),
        env
      );
      expect(bearerPoll.status).toBe(200);
      const bearerJson = (await bearerPoll.json()) as { events: unknown[]; nextCursor: string };
      expect(bearerJson.events, `since=${bypassSince} should not leak 48h old tx`).toHaveLength(0);
      expect(bearerJson.nextCursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }

    // PERF-H1: Verify last_seen_at was set on first poll and NOT overwritten on immediate second poll,
    // and ZERO rate_limits rows were written for valid polls!
    const seen1 = (
      rawDb
        .prepare(`SELECT last_seen_at FROM soundboxes WHERE id = ?`)
        .get(sbJson.soundbox.id) as { last_seen_at: string }
    ).last_seen_at;
    expect(seen1).toBeTruthy();

    await new Promise((r) => setTimeout(r, 15));
    const poll2 = await app.fetch(
      new Request(`${ORIGIN}/api/soundbox/events`, {
        headers: { Authorization: `Bearer ${sbJson.kioskToken}` },
      }),
      env
    );
    expect(poll2.status).toBe(200);
    const seen2 = (
      rawDb
        .prepare(`SELECT last_seen_at FROM soundboxes WHERE id = ?`)
        .get(sbJson.soundbox.id) as { last_seen_at: string }
    ).last_seen_at;
    expect(seen2).toBe(seen1);

    const rlCount = (
      rawDb
        .prepare(`SELECT COUNT(*) AS cnt FROM rate_limits WHERE bucket_key LIKE 'soundbox%'`)
        .get() as { cnt: number }
    ).cnt;
    expect(rlCount).toBe(0);

    // Deleting acc1 MUST disable acc1's soundbox and NEVER widen to acc2's 99M treasury tx!
    const delAcc1 = await app.fetch(
      new Request(`${ORIGIN}/v1/bank-accounts/${acc1.bankAccount.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie, Origin: ORIGIN },
      }),
      env
    );
    expect(delAcc1.status).toBe(200);

    const afterDeletePoll = await app.fetch(
      new Request(`${ORIGIN}/api/soundbox/${sbJson.kioskToken}/events`),
      env
    );
    expect(afterDeletePoll.status).toBe(404);

    // Even if someone re-enables the orphaned soundbox directly in DB, scope='account' + NULL bank_account_id STILL returns 404!
    rawDb.prepare(`UPDATE soundboxes SET enabled = 1 WHERE id = ?`).run(sbJson.soundbox.id);
    const orphanPoll = await app.fetch(
      new Request(`${ORIGIN}/api/soundbox/${sbJson.kioskToken}/events`),
      env
    );
    expect(orphanPoll.status).toBe(404);

    // Uniform 404 HTML does not leak Soundbox name and includes viewport + CSP + no-store
    const orphanKiosk = await app.fetch(
      new Request(`${ORIGIN}/soundbox/${sbJson.kioskToken}`),
      env
    );
    expect(orphanKiosk.status).toBe(404);
    expect(orphanKiosk.headers.get('cache-control')).toBe('no-store');
    expect(orphanKiosk.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const orphanHtml = await orphanKiosk.text();
    expect(orphanHtml).not.toContain('Secret Cashier Loa');
    expect(orphanHtml).toContain('viewport');
  }, 20_000);

  it('MED-1, UI-H1, LOW-4, multi-tenant IDOR, logout-all, ingest size cap & hourly cron gating', async () => {
    // MED-1: ALLOW_PUBLIC_SIGNUP fails closed for undefined, '', 'false ', '0', 'no'
    for (const val of [undefined, '', 'false', 'false ', '0', 'no']) {
      const { env: closedEnv, app: closedApp } = setupEnv({
        ALLOW_PUBLIC_SIGNUP: val,
        ADMIN_BOOTSTRAP_KEY: 'super-secret-bootstrap-key',
      });
      const r = await closedApp.fetch(
        new Request(`${ORIGIN}/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'new@shop.vn', password: 'Password123!' }),
        }),
        closedEnv
      );
      expect(r.status).toBe(403);
    }

    // MED-1: ADMIN_BOOTSTRAP_KEY succeeds ONLY for 0-user initial setup, then fails for user #2
    const { env: bsEnv, app: bsApp } = setupEnv({
      ALLOW_PUBLIC_SIGNUP: 'false',
      ADMIN_BOOTSTRAP_KEY: 'bootstrap-once-key-123',
    });
    const firstBs = await bsApp.fetch(
      new Request(`${ORIGIN}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@shop.vn',
          password: 'Password123!',
          bootstrapKey: 'bootstrap-once-key-123',
        }),
      }),
      bsEnv
    );
    expect(firstBs.status).toBe(201);

    const secondBs = await bsApp.fetch(
      new Request(`${ORIGIN}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'second@shop.vn',
          password: 'Password123!',
          bootstrapKey: 'bootstrap-once-key-123',
        }),
      }),
      bsEnv
    );
    expect(secondBs.status).toBe(403);

    // Main multi-tenant + UI-H1 + LOW-4 + logout-all + ingest cap + cron test
    const sigs: Array<{ sig: string; body: string }> = [];
    const { env, app } = setupEnv({}, async (_input, init) => {
      const hdrs = init?.headers as Record<string, string>;
      sigs.push({ sig: hdrs['X-Comey-Signature'] || '', body: String(init?.body || '') });
      return new Response('ok', { status: 200 });
    });

    const userA = await registerUser(app, env, 'tenantA@shop.vn');
    const userB = await registerUser(app, env, 'tenantB@shop.vn');
    const accA = await createBankAccount(app, env, userA.cookie, '0901234567');

    // UI-H1: Wrong current password returns 400 (NOT 401!) and keeps session valid
    const wrongPw = await app.fetch(
      new Request(`${ORIGIN}/v1/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          currentPassword: 'WrongPassword1!',
          newPassword: 'NewPassword456!',
        }),
      }),
      env
    );
    expect(wrongPw.status).toBe(400);

    // Multi-tenant IDOR: Tenant B cannot read/mutate Tenant A's bank account
    const idorPatch = await app.fetch(
      new Request(`${ORIGIN}/v1/bank-accounts/${accA.bankAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: userB.cookie, Origin: ORIGIN },
        body: JSON.stringify({ strictAuth: false }),
      }),
      env
    );
    expect(idorPatch.status).toBe(404);

    // LOW-4: Replay uses rotated routing rule secret & PERF-L3 list omits payloadJson
    const ruleRes = await app.fetch(
      new Request(`${ORIGIN}/v1/routing-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: accA.bankAccount.id,
          name: 'Replay Rule',
          matchType: 'all',
          webhookUrl: 'https://merchant.example.com/replay',
        }),
      }),
      env
    );
    const ruleJson = (await ruleRes.json()) as {
      routingRule: { id: string };
      webhookSecret: string;
    };
    const oldSecret = ruleJson.webhookSecret;

    await app.fetch(
      new Request(`${ORIGIN}/v1/simulator/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie, Origin: ORIGIN },
        body: JSON.stringify({
          bankAccountId: accA.bankAccount.id,
          amount: 60000,
          content: 'REPLAY1',
        }),
      }),
      env
    );

    const listDlv = (await (
      await app.fetch(
        new Request(`${ORIGIN}/v1/deliveries`, { headers: { Cookie: userA.cookie } }),
        env
      )
    ).json()) as { deliveries: Array<{ id: string; payloadJson?: unknown }> };
    expect(listDlv.deliveries).toHaveLength(1);
    expect(listDlv.deliveries[0]!.payloadJson).toBeUndefined();
    const deliveryId = listDlv.deliveries[0]!.id;

    // Rotate secret, then replay -> MUST sign with NEW secret!
    const rotRes = await app.fetch(
      new Request(`${ORIGIN}/v1/routing-rules/${ruleJson.routingRule.id}/rotate-secret`, {
        method: 'POST',
        headers: { Cookie: userA.cookie, Origin: ORIGIN },
      }),
      env
    );
    const newSecret = ((await rotRes.json()) as { webhookSecret: string }).webhookSecret;

    const replayRes = await app.fetch(
      new Request(`${ORIGIN}/v1/deliveries/${deliveryId}/replay`, {
        method: 'POST',
        headers: { Cookie: userA.cookie, Origin: ORIGIN },
      }),
      env
    );
    expect(replayRes.status).toBe(200);
    const replayedSig = sigs[sigs.length - 1]!;
    expect((await verifyWebhookSignature(replayedSig.body, replayedSig.sig, newSecret)).valid).toBe(
      true
    );
    expect((await verifyWebhookSignature(replayedSig.body, replayedSig.sig, oldSecret)).valid).toBe(
      false
    );

    // MED-2: /v1/ingest/apps-script rejects >256KB payload with 413
    const hugeBody = JSON.stringify({ from: 'no-reply@cake.vn', textBody: 'A'.repeat(270_000) });
    const hugeIngest = await app.fetch(
      new Request(`${ORIGIN}/v1/ingest/apps-script`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accA.appsScriptToken}`,
        },
        body: hugeBody,
      }),
      env
    );
    expect(hugeIngest.status).toBe(413);

    // PERF-H4: Cron skips heavy cleanup when UTC minutes !== 0, and runs it at UTC minute === 0
    const nonZeroMinuteMs = Date.UTC(2030, 0, 1, 12, 15, 0);
    const zeroMinuteMs = Date.UTC(2030, 0, 1, 12, 0, 0);
    const mSkip = await runScheduledMaintenance(env, { nowMs: nonZeroMinuteMs });
    expect(mSkip.purgedAuthSessions).toBe(0);
    const mRun = await runScheduledMaintenance(env, { nowMs: zeroMinuteMs });
    expect(mRun.purgedAuthSessions).toBeGreaterThanOrEqual(2);

    // Re-login two sessions and verify logout-all revokes BOTH sessions
    const login1 = await app.fetch(
      new Request(`${ORIGIN}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'tenantA@shop.vn', password: 'Password123!' }),
      }),
      env
    );
    const c1 = (login1.headers.get('set-cookie') || '').split(';')[0]!;
    const login2 = await app.fetch(
      new Request(`${ORIGIN}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'tenantA@shop.vn', password: 'Password123!' }),
      }),
      env
    );
    const c2 = (login2.headers.get('set-cookie') || '').split(';')[0]!;

    const logoutAll = await app.fetch(
      new Request(`${ORIGIN}/v1/auth/logout-all`, {
        method: 'POST',
        headers: { Cookie: c1, Origin: ORIGIN },
      }),
      env
    );
    expect(logoutAll.status).toBe(200);

    const me1 = await app.fetch(
      new Request(`${ORIGIN}/v1/auth/me`, { headers: { Cookie: c1 } }),
      env
    );
    const me2 = await app.fetch(
      new Request(`${ORIGIN}/v1/auth/me`, { headers: { Cookie: c2 } }),
      env
    );
    expect(me1.status).toBe(401);
    expect(me2.status).toBe(401);
  }, 20_000);
});
