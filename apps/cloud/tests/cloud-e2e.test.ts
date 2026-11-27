import { resolve } from 'node:path';
import { verifyWebhookSignature } from '@comey/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { handleInboundEmail } from '../src/handlers/emailWorker.js';
import { runScheduledMaintenance } from '../src/services/cron.js';
import { createTestD1Database } from './helpers/sqliteD1.js';

const MIGRATION_PATH = resolve(import.meta.dirname, '../migrations');

function createMockCtx(): {
  ctx: ExecutionContext;
  waitPromises: Promise<unknown>[];
} {
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

function makeRawStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function setupTestEnv(webhookFetch?: typeof fetch) {
  const { d1, rawDb } = createTestD1Database(MIGRATION_PATH);
  const env: Env = {
    DB: d1,
    MASTER_ENCRYPTION_KEY: 'test_master_encryption_key_32_bytes!!',
    SESSION_SECRET: 'test_session_secret_32_bytes!!',
    INBOUND_EMAIL_DOMAIN: 'in.comey.test',
    PUBLIC_BASE_URL: 'https://pay.comey.test',
    ALLOW_PUBLIC_SIGNUP: 'true',
  };
  const app = createApp({ webhookFetch });
  return { env, app, rawDb };
}

describe('Comey Cloud E2E Integration', () => {
  it('runs full flow: signup, API key, bank account, Email Worker DKIM verify, routing, HMAC webhook, Quarantine, Checkout, Simulator & Cron retry', async () => {
    const receivedWebhooks: Array<{
      url: string;
      headers: Record<string, string>;
      body: string;
    }> = [];
    let failFirstWebhook = false;

    const mockWebhookFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (failFirstWebhook) {
        failFirstWebhook = false;
        return new Response('Upstream error', { status: 500 });
      }
      const hdrs: Record<string, string> = {};
      if (init?.headers && !(init.headers instanceof Headers)) {
        for (const [k, v] of Object.entries(init.headers)) {
          hdrs[k.toLowerCase()] = String(v);
        }
      }
      receivedWebhooks.push({
        url,
        headers: hdrs,
        body: String(init?.body || ''),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const { env, app } = setupTestEnv(mockWebhookFetch);

    // 1. Register user & capture session cookie
    const regResp = await app.fetch(
      new Request('https://pay.comey.test/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@shop.vn',
          password: 'Password123!',
          name: 'Shop Owner',
          workspaceName: '7Cu Store',
        }),
      }),
      env
    );
    expect(regResp.status).toBe(201);
    const setCookie = regResp.headers.get('set-cookie') || '';
    expect(setCookie).toContain('comey_session=');
    const cookieHeader = setCookie.split(';')[0]!;

    // Verify /v1/auth/me works with cookie
    const meResp = await app.fetch(
      new Request('https://pay.comey.test/v1/auth/me', {
        headers: { Cookie: cookieHeader },
      }),
      env
    );
    expect(meResp.status).toBe(200);
    const meJson = (await meResp.json()) as { user: { email: string } };
    expect(meJson.user.email).toBe('owner@shop.vn');

    // 2. Create API key
    const keyResp = await app.fetch(
      new Request('https://pay.comey.test/v1/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({ name: 'Production Bot' }),
      }),
      env
    );
    expect(keyResp.status).toBe(201);
    const keyJson = (await keyResp.json()) as {
      apiKey: { id: string; plaintextKey: string };
    };
    const apiKey = keyJson.apiKey.plaintextKey;
    expect(apiKey.startsWith('cm_live_')).toBe(true);

    // 3. Create Bank Account via API Key
    const baResp = await app.fetch(
      new Request('https://pay.comey.test/v1/bank-accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          bankCode: 'CAKE',
          accountNumber: '0835117727',
          accountName: 'TRAN MINH TAN',
        }),
      }),
      env
    );
    expect(baResp.status).toBe(201);
    const baJson = (await baResp.json()) as {
      bankAccount: { id: string; inboundEmail: string; inboundAlias: string };
      appsScriptToken: string;
    };
    const bankAccountId = baJson.bankAccount.id;
    const inboundEmail = baJson.bankAccount.inboundEmail;
    const appsScriptToken = baJson.appsScriptToken;
    expect(inboundEmail).toContain('@in.comey.test');

    // Generate Apps Script bridge code for this bank account
    const gsResp = await app.fetch(
      new Request(
        `https://pay.comey.test/v1/bank-accounts/${bankAccountId}/apps-script?mode=cloud_bridge`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      ),
      env
    );
    expect(gsResp.status).toBe(200);
    const gsJson = (await gsResp.json()) as { code: string };
    expect(gsJson.code).toContain('0835117727');
    expect(gsJson.code).toContain('https://pay.comey.test/v1/ingest/apps-script');

    // 4. Create Routing Rule (prefix SHOP -> Shop Webhook)
    const ruleResp = await app.fetch(
      new Request('https://pay.comey.test/v1/routing-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          bankAccountId,
          name: 'Shop Orders',
          matchType: 'prefix',
          pattern: 'SHOP',
          priority: 10,
          webhookUrl: 'https://merchant.example.com/webhooks/comey',
        }),
      }),
      env
    );
    expect(ruleResp.status).toBe(201);
    const ruleJson = (await ruleResp.json()) as { webhookSecret: string };
    const webhookSecret = ruleJson.webhookSecret;

    // 5. Email Worker receives Gmail Forwarding Confirmation -> captured on bank_account
    const { ctx: ctxFwd } = createMockCtx();
    const fwdMime = [
      'From: Gmail Team <forwarding-noreply@google.com>',
      `To: ${inboundEmail}`,
      'Subject: Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com',
      'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=google.com; spf=pass',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'owner@gmail.com has requested to automatically forward mail.',
      'Confirmation code: 918273645',
      'https://mail-settings.google.com/mail/vf-abc123',
    ].join('\r\n');

    const fwdRes = await handleInboundEmail(
      {
        from: 'forwarding-noreply@google.com',
        to: inboundEmail,
        raw: makeRawStream(fwdMime),
        setReject: () => {},
      },
      env,
      ctxFwd
    );
    expect(fwdRes?.status).toBe('forwarding_confirmation');

    const baCheckResp = await app.fetch(
      new Request('https://pay.comey.test/v1/bank-accounts', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      env
    );
    const baList = (await baCheckResp.json()) as {
      bankAccounts: Array<{ forwardingStatus: string; forwardingConfirmCode: string }>;
    };
    expect(baList.bankAccounts[0]?.forwardingStatus).toBe('confirmation_received');
    expect(baList.bankAccounts[0]?.forwardingConfirmCode).toBe('918273645');

    // 6. Spoofed Cake Email (unaligned DKIM) -> blocked & stored in Quarantine, NO webhook sent!
    const { ctx: ctxSpoof } = createMockCtx();
    const spoofMime = [
      'From: "Cake by VPBank" <no-reply@cake.vn>',
      `To: ${inboundEmail}`,
      'Subject: Thong bao bien dong so du',
      'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=evil.com; spf=fail',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Tài khoản nhận: 0835117727',
      'Số tiền: +500.000 đ',
      'Mã giao dịch: FTSPOOF999',
      'Nội dung giao dịch: SHOP999999',
    ].join('\r\n');

    const spoofRes = await handleInboundEmail(
      {
        from: 'no-reply@cake.vn',
        to: inboundEmail,
        raw: makeRawStream(spoofMime),
        setReject: () => {},
      },
      env,
      ctxSpoof,
      { syncWebhooks: true, fetchImpl: mockWebhookFetch }
    );
    expect(spoofRes?.status).toBe('quarantined');
    expect(receivedWebhooks).toHaveLength(0);

    const qResp = await app.fetch(
      new Request('https://pay.comey.test/v1/quarantine', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      env
    );
    const qJson = (await qResp.json()) as {
      quarantine: Array<{ id: string; authStatus: string }>;
    };
    expect(qJson.quarantine).toHaveLength(1);
    expect(qJson.quarantine[0]?.authStatus).toBe('spoof_suspected');

    // 7. Create Layer 2 Payment Session (SHOP100200, 80,000đ) + verify SSR Hosted Checkout
    const sessResp = await app.fetch(
      new Request('https://pay.comey.test/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          bankAccountId,
          orderCode: 'SHOP100200',
          amount: 80000,
          ttlSeconds: 600,
          returnUrl: 'https://shop.vn/orders/100200',
        }),
      }),
      env
    );
    expect(sessResp.status).toBe(201);
    const sessJson = (await sessResp.json()) as {
      session: { id: string; shortId: string };
      checkoutUrl: string;
      vietqr: { emvco: string; svg: string };
    };
    const shortId = sessJson.session.shortId;
    expect(sessJson.vietqr.svg).toContain('<svg ');

    const portalHtmlResp = await app.fetch(
      new Request(`https://pay.comey.test/p/${shortId}`),
      env
    );
    expect(portalHtmlResp.status).toBe(200);
    const portalHtml = await portalHtmlResp.text();
    expect(portalHtml).toContain('SHOP100200');
    expect(portalHtml).toContain('<svg ');

    const pngResp = await app.fetch(
      new Request(`https://pay.comey.test/p/${shortId}/qr.png`),
      env
    );
    expect(pngResp.status).toBe(200);
    expect(pngResp.headers.get('content-type')).toBe('image/png');
    const pngBytes = new Uint8Array(await pngResp.arrayBuffer());
    expect(Array.from(pngBytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    // 8. Email Worker receives genuine Cake email -> parses, settles session to 'paid', fires HMAC webhooks!
    const { ctx: ctxReal, waitPromises } = createMockCtx();
    const realMime = [
      'From: "Cake by VPBank" <no-reply@cake.vn>',
      `To: ${inboundEmail}`,
      'Subject: Thông báo biến động số dư',
      'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=cake.vn; spf=pass',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Tài khoản nhận: 0835117727',
      'Số tiền: +80.000 đ',
      'Mã giao dịch: FTREAL202601',
      'Ngày giờ giao dịch: 26/11/2026 10:15:00',
      'Nội dung giao dịch: SHOP 100200',
    ].join('\r\n');

    const realRes = await handleInboundEmail(
      {
        from: 'no-reply@cake.vn',
        to: inboundEmail,
        raw: makeRawStream(realMime),
        setReject: () => {},
      },
      env,
      ctxReal,
      { fetchImpl: mockWebhookFetch }
    );
    await Promise.all(waitPromises);

    expect(realRes?.status).toBe('parsed');
    if (realRes?.status === 'parsed') {
      expect(realRes.sessionAction).toBe('paid');
      expect(realRes.matchedOrderCode).toBe('SHOP100200');
    }

    // Verify 2 signed webhooks arrived (transaction.received + session.paid)
    expect(receivedWebhooks).toHaveLength(2);
    for (const wh of receivedWebhooks) {
      const sigCheck = await verifyWebhookSignature(
        wh.body,
        wh.headers['x-comey-signature'] || '',
        webhookSecret
      );
      expect(sigCheck.valid).toBe(true);
    }

    // Duplicate email must be ignored cleanly (no extra webhook)
    const { ctx: ctxDup } = createMockCtx();
    const dupRes = await handleInboundEmail(
      {
        from: 'no-reply@cake.vn',
        to: inboundEmail,
        raw: makeRawStream(realMime),
        setReject: () => {},
      },
      env,
      ctxDup,
      { syncWebhooks: true, fetchImpl: mockWebhookFetch }
    );
    expect(dupRes?.status).toBe('duplicate');
    expect(receivedWebhooks).toHaveLength(2);

    // Hosted Checkout status endpoint now reports 'paid'
    const statusResp = await app.fetch(
      new Request(`https://pay.comey.test/api/checkout/${shortId}/status`),
      env
    );
    const statusJson = (await statusResp.json()) as {
      session: { status: string; receivedAmount: number };
    };
    expect(statusJson.session.status).toBe('paid');
    expect(statusJson.session.receivedAmount).toBe(80000);

    // 9. Apps Script Bridge Ingest + Cron Retry after temporary 500
    failFirstWebhook = true;
    const asIngestResp = await app.fetch(
      new Request('https://pay.comey.test/v1/ingest/apps-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appsScriptToken}`,
        },
        body: JSON.stringify({
          messageId: 'gas_msg_1',
          from: 'no-reply@cake.vn',
          subject: 'Thông báo biến động số dư',
          authenticationResults: 'mx.google.com; dkim=pass header.d=cake.vn; spf=pass',
          textBody: [
            'Tài khoản nhận: 0835117727',
            'Số tiền: +45.000 đ',
            'Mã giao dịch: FTGAS0002',
            'Nội dung giao dịch: SHOP555666',
          ].join('\n'),
        }),
      }),
      env
    );
    expect(asIngestResp.status).toBe(200);
    const asJson = (await asIngestResp.json()) as {
      status: string;
      matched: boolean;
    };
    expect(asJson.status).toBe('parsed');
    expect(asJson.matched).toBe(true);

    // Delivery #3 failed with 500 -> marked 'retrying'
    const retryingResp = await app.fetch(
      new Request('https://pay.comey.test/v1/deliveries?status=retrying', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      env
    );
    const retryingJson = (await retryingResp.json()) as {
      deliveries: Array<{ id: string; attemptCount: number }>;
    };
    expect(retryingJson.deliveries).toHaveLength(1);
    expect(retryingJson.deliveries[0]?.attemptCount).toBe(1);

    // Run Cron 73 hours later with forceCleanup -> retries delivery -> succeeds! Also test 72h Quarantine purge.
    const maintenance = await runScheduledMaintenance(env, {
      nowMs: Date.now() + 73 * 3600 * 1000,
      fetchImpl: mockWebhookFetch,
      forceCleanup: true,
    });
    expect(maintenance.retriedWebhooks).toBe(1);
    expect(maintenance.purgedQuarantine).toBe(1);
    expect(receivedWebhooks).toHaveLength(3);

    // 10. Simulator + Polling API
    const simResp = await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          bankAccountId,
          amount: 120000,
          content: 'SHOP777888',
        }),
      }),
      env
    );
    expect(simResp.status).toBe(200);
    expect(receivedWebhooks).toHaveLength(4);

    const pollResp = await app.fetch(
      new Request('https://pay.comey.test/v1/transactions?orderCode=SHOP777888', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      env
    );
    expect(pollResp.status).toBe(200);
    const pollJson = (await pollResp.json()) as {
      transactions: Array<{ amount: number; isTest: boolean }>;
    };
    expect(pollJson.transactions).toHaveLength(1);
    expect(pollJson.transactions[0]?.amount).toBe(120000);
    expect(pollJson.transactions[0]?.isTest).toBe(true);

    // Revoke API key -> subsequent calls fail with 401
    const revokeResp = await app.fetch(
      new Request(`https://pay.comey.test/v1/api-keys/${keyJson.apiKey.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader, Origin: 'https://pay.comey.test' },
      }),
      env
    );
    expect(revokeResp.status).toBe(200);

    const blockedResp = await app.fetch(
      new Request('https://pay.comey.test/v1/transactions', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      env
    );
    expect(blockedResp.status).toBe(401);
  }, 20_000);

  it('enforces financial edge cases (underpaid, overpaid exactMatchOnly, late_payment after cancel/expire)', async () => {
    const { env, app } = setupTestEnv(async () => new Response('ok', { status: 200 }));

    // Register & setup bank account
    const reg = await app.fetch(
      new Request('https://pay.comey.test/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'edge@shop.vn', password: 'Password123!' }),
      }),
      env
    );
    const cookie = (reg.headers.get('set-cookie') || '').split(';')[0]!;

    const baResp = await app.fetch(
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
    const { bankAccount } = (await baResp.json()) as { bankAccount: { id: string } };

    // A. Underpayment session
    const sUnder = await app.fetch(
      new Request('https://pay.comey.test/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          orderCode: 'EDGEUNDER1',
          amount: 100000,
        }),
      }),
      env
    );
    const underId = ((await sUnder.json()) as { session: { id: string } }).session.id;

    await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          amount: 85000,
          content: 'EDGEUNDER1',
        }),
      }),
      env
    );

    const underCheck = (await (
      await app.fetch(
        new Request(`https://pay.comey.test/v1/sessions/${underId}`, {
          headers: { Cookie: cookie },
        }),
        env
      )
    ).json()) as { session: { status: string; missingAmount: number } };
    expect(underCheck.session.status).toBe('underpaid');
    expect(underCheck.session.missingAmount).toBe(15000);

    // B. ExactMatchOnly overpaid -> overpaid_review
    const sExact = await app.fetch(
      new Request('https://pay.comey.test/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          orderCode: 'EDGEEXACT1',
          amount: 100000,
          exactMatchOnly: true,
        }),
      }),
      env
    );
    const exactId = ((await sExact.json()) as { session: { id: string } }).session.id;

    await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          amount: 110000,
          content: 'EDGEEXACT1',
        }),
      }),
      env
    );

    const exactCheck = (await (
      await app.fetch(
        new Request(`https://pay.comey.test/v1/sessions/${exactId}`, {
          headers: { Cookie: cookie },
        }),
        env
      )
    ).json()) as { session: { status: string; excessAmount: number } };
    expect(exactCheck.session.status).toBe('overpaid_review');
    expect(exactCheck.session.excessAmount).toBe(10000);

    // C. Cancelled session receiving transfer -> stays cancelled (late_payment, never paid)
    const sCancel = await app.fetch(
      new Request('https://pay.comey.test/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          orderCode: 'EDGECANCEL1',
          amount: 50000,
        }),
      }),
      env
    );
    const cancelId = ((await sCancel.json()) as { session: { id: string } }).session.id;

    await app.fetch(
      new Request(`https://pay.comey.test/v1/sessions/${cancelId}/cancel`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://pay.comey.test' },
      }),
      env
    );

    const simCancel = (await (
      await app.fetch(
        new Request('https://pay.comey.test/v1/simulator/transfer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId: bankAccount.id,
            amount: 50000,
            content: 'EDGECANCEL1',
          }),
        }),
        env
      )
    ).json()) as { simulation: { sessionAction: string } };
    expect(simCancel.simulation.sessionAction).toBe('late_payment');

    const cancelCheck = (await (
      await app.fetch(
        new Request(`https://pay.comey.test/v1/sessions/${cancelId}`, {
          headers: { Cookie: cookie },
        }),
        env
      )
    ).json()) as { session: { status: string } };
    expect(cancelCheck.session.status).toBe('cancelled');
  }, 20_000);
});
