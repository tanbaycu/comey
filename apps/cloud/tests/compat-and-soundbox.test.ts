import { resolve } from 'node:path';
import { verifyPayOSWebhookSignature } from '@comey/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { SANDBOX_WEBHOOK_URL } from '../src/security/urlGuard.js';
import { createTestD1Database } from './helpers/sqliteD1.js';

const MIGRATION_PATH = resolve(import.meta.dirname, '../migrations');

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

async function bootstrapWorkspaceWithAccount(
  app: ReturnType<typeof createApp>,
  env: Env
): Promise<{ cookie: string; accountId: string }> {
  const regResp = await app.fetch(
    new Request('https://pay.comey.test/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'compat@comey.vn',
        password: 'Password123!',
        name: 'Compat Tester',
        workspaceName: 'Compat Shop',
      }),
    }),
    env
  );
  expect(regResp.status).toBe(201);
  const setCookie = regResp.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0] || '';
  expect(cookie).toContain('comey_session=');

  const accResp = await app.fetch(
    new Request('https://pay.comey.test/v1/bank-accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://pay.comey.test',
      },
      body: JSON.stringify({
        bankCode: 'cake',
        accountNumber: '0909888777',
        accountName: 'SHOP COMEY',
        strictAuth: true,
      }),
    }),
    env
  );
  expect(accResp.status).toBe(201);
  const accJson = (await accResp.json()) as {
    bankAccount: { id: string };
  };
  return { cookie, accountId: accJson.bankAccount.id };
}

describe('SePay / PayOS Compatibility, Sandbox Inbox & Soundbox E2E', () => {
  it('dispatches drop-in SePay & PayOS webhooks, respects single drop-in per tx, and logs Sandbox Inbox locally', async () => {
    const outboundCalls: Array<{
      url: string;
      headers: Record<string, string>;
      body: string;
    }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const hdrs: Record<string, string> = {};
      if (init?.headers && !(init.headers instanceof Headers)) {
        for (const [k, v] of Object.entries(init.headers)) {
          hdrs[k.toLowerCase()] = String(v);
        }
      }
      outboundCalls.push({
        url,
        headers: hdrs,
        body: String(init?.body || ''),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const { env, app } = setupTestEnv(mockFetch);
    const { cookie, accountId } = await bootstrapWorkspaceWithAccount(app, env);

    // Rule 1: SePay format
    const sepayRuleResp = await app.fetch(
      new Request('https://pay.comey.test/v1/routing-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: accountId,
          name: 'SePay Store Hook',
          matchType: 'prefix',
          pattern: 'ORDER',
          priority: 10,
          payloadFormat: 'sepay',
          webhookUrl: 'https://sepay-consumer.example.com/hooks/sepay',
          stopOnMatch: false,
        }),
      }),
      env
    );
    expect(sepayRuleResp.status).toBe(201);
    const sepayRuleJson = (await sepayRuleResp.json()) as {
      routingRule: { payloadFormat: string };
      webhookSecret: string;
    };
    expect(sepayRuleJson.routingRule.payloadFormat).toBe('sepay');

    // Rule 2: PayOS format
    const payosRuleResp = await app.fetch(
      new Request('https://pay.comey.test/v1/routing-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: accountId,
          name: 'PayOS Store Hook',
          matchType: 'prefix',
          pattern: 'ORDER',
          priority: 20,
          payloadFormat: 'payos',
          webhookUrl: 'https://payos-consumer.example.com/hooks/payos',
          stopOnMatch: false,
        }),
      }),
      env
    );
    expect(payosRuleResp.status).toBe(201);
    const payosRuleJson = (await payosRuleResp.json()) as {
      routingRule: { payloadFormat: string };
      webhookSecret: string;
    };
    expect(payosRuleJson.routingRule.payloadFormat).toBe('payos');

    // Rule 3: Built-in Sandbox Inbox (must NOT perform outbound HTTP fetch)
    const sandboxRuleResp = await app.fetch(
      new Request('https://pay.comey.test/v1/routing-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: accountId,
          name: 'Local Sandbox SePay Test',
          matchType: 'all',
          priority: 30,
          payloadFormat: 'sepay',
          webhookUrl: SANDBOX_WEBHOOK_URL,
          stopOnMatch: false,
        }),
      }),
      env
    );
    expect(sandboxRuleResp.status).toBe(201);

    // Create a matching Checkout Session as well to prove SePay/PayOS drop-in rules only fire ONCE per tx
    const sessResp = await app.fetch(
      new Request('https://pay.comey.test/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: accountId,
          orderCode: 'ORDER7788',
          amount: 150000,
        }),
      }),
      env
    );
    expect(sessResp.status).toBe(201);

    // Simulate incoming bank transfer matching ORDER7788 (explicitly opt into external SePay/PayOS hooks)
    const simResp = await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: accountId,
          amount: 150000,
          content: 'ORDER7788 Thanh toan don hang',
          senderName: 'NGUYEN VAN B',
          allowExternalWebhooks: true,
        }),
      }),
      env
    );
    expect(simResp.status).toBe(200);

    // Outbound HTTP fetch must have only 2 calls: SePay once + PayOS once (Sandbox never calls fetch)
    expect(outboundCalls).toHaveLength(2);

    const sepayCall = outboundCalls.find((c) => c.url.includes('sepay-consumer'));
    expect(sepayCall).toBeDefined();
    expect(sepayCall!.headers.authorization).toBe(`Apikey ${sepayRuleJson.webhookSecret}`);
    const sepayBody = JSON.parse(sepayCall!.body) as {
      id: number;
      gateway: string;
      transferType: string;
      transferAmount: number;
      content: string;
      accountNumber: string;
      transactionDate: string;
    };
    expect(sepayBody.id).toBeGreaterThan(0);
    expect(sepayBody.gateway).toBe('CAKE');
    expect(sepayBody.transferType).toBe('in');
    expect(sepayBody.transferAmount).toBe(150000);
    expect(sepayBody.accountNumber).toBe('0909888777');
    expect(sepayBody.transactionDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const payosCall = outboundCalls.find((c) => c.url.includes('payos-consumer'));
    expect(payosCall).toBeDefined();
    const payosBody = JSON.parse(payosCall!.body) as {
      code: string;
      success: boolean;
      data: Record<string, unknown> & { amount: number; orderCode: number };
      signature: string;
    };
    expect(payosBody.code).toBe('00');
    expect(payosBody.success).toBe(true);
    expect(payosBody.data.amount).toBe(150000);
    expect(await verifyPayOSWebhookSignature(payosBody, payosRuleJson.webhookSecret)).toBe(true);

    // Check deliveries list + GET /v1/deliveries/:id payload inspector on Sandbox Inbox delivery
    const dlvListResp = await app.fetch(
      new Request('https://pay.comey.test/v1/deliveries', {
        headers: { Cookie: cookie },
      }),
      env
    );
    expect(dlvListResp.status).toBe(200);
    const dlvListJson = (await dlvListResp.json()) as {
      deliveries: Array<{
        id: string;
        targetUrl: string;
        payloadFormat: string;
        status: string;
        lastHttpStatus: number | null;
      }>;
    };

    const sandboxDlv = dlvListJson.deliveries.find(
      (d) => d.targetUrl === SANDBOX_WEBHOOK_URL
    );
    expect(sandboxDlv).toBeDefined();
    expect(sandboxDlv!.status).toBe('delivered');
    expect(sandboxDlv!.lastHttpStatus).toBe(200);
    expect(sandboxDlv!.payloadFormat).toBe('sepay');

    const dlvDetailResp = await app.fetch(
      new Request(`https://pay.comey.test/v1/deliveries/${sandboxDlv!.id}`, {
        headers: { Cookie: cookie },
      }),
      env
    );
    expect(dlvDetailResp.status).toBe(200);
    const dlvDetailJson = (await dlvDetailResp.json()) as {
      delivery: {
        payloadFormat: string;
        payloadJson: string;
        webhook_secret_enc?: unknown;
      };
    };
    expect(dlvDetailJson.delivery.webhook_secret_enc).toBeUndefined();
    const inspectedPayload = JSON.parse(dlvDetailJson.delivery.payloadJson) as {
      transferAmount: number;
      content: string;
    };
    expect(inspectedPayload.transferAmount).toBe(150000);
    expect(inspectedPayload.content).toContain('ORDER7788');
  }, 20_000);

  it('supports Soundbox creation, Kiosk SSR, IoT JSON polling with minAmount, token rotation, and toggle disable', async () => {
    const { env, app } = setupTestEnv();
    const { cookie, accountId } = await bootstrapWorkspaceWithAccount(app, env);

    const createResp = await app.fetch(
      new Request('https://pay.comey.test/v1/soundboxes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          name: 'Loa Quầy 1',
          bankAccountId: accountId,
          minAmount: 50000,
          voiceLang: 'vi-VN',
        }),
      }),
      env
    );
    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as {
      soundbox: { id: string; name: string; minAmount: number; tokenPreview: string };
      kioskToken: string;
      kioskUrl: string;
      eventsUrl: string;
    };
    expect(created.kioskToken).toMatch(/^sbx_/);
    expect(created.kioskUrl).toBe(`https://pay.comey.test/soundbox/${created.kioskToken}`);

    // List endpoint masks token instead of leaking raw secret token
    const listResp = await app.fetch(
      new Request('https://pay.comey.test/v1/soundboxes', {
        headers: { Cookie: cookie },
      }),
      env
    );
    expect(listResp.status).toBe(200);
    const listJson = (await listResp.json()) as {
      soundboxes: Array<Record<string, unknown>>;
    };
    expect(listJson.soundboxes).toHaveLength(1);
    expect(listJson.soundboxes[0]!.kioskToken).toBeUndefined();
    expect(listJson.soundboxes[0]!.tokenPreview).toContain('...');

    // Public Kiosk HTML renders cleanly
    const kioskResp = await app.fetch(
      new Request(`https://pay.comey.test/soundbox/${created.kioskToken}`),
      env
    );
    expect(kioskResp.status).toBe(200);
    const kioskHtml = await kioskResp.text();
    expect(kioskHtml).toContain('Loa Quầy 1');
    expect(kioskHtml).toContain('Bật Âm Thanh');

    // Simulate one small tx (< 50,000) and one valid tx (>= 50,000)
    await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: accountId,
          amount: 20000,
          content: 'SMALL20K',
        }),
      }),
      env
    );

    await app.fetch(
      new Request('https://pay.comey.test/v1/simulator/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({
          bankAccountId: accountId,
          amount: 80000,
          content: 'PAY80K tra sua',
        }),
      }),
      env
    );

    const eventsResp = await app.fetch(
      new Request(`https://pay.comey.test/api/soundbox/${created.kioskToken}/events`),
      env
    );
    expect(eventsResp.status).toBe(200);
    const eventsJson = (await eventsResp.json()) as {
      ok: boolean;
      nextCursor: string;
      events: Array<{
        amount: number;
        accountNumber: string;
        amountWords: string;
        speechText: string;
      }>;
    };
    expect(eventsJson.ok).toBe(true);
    expect(eventsJson.events).toHaveLength(1);
    expect(eventsJson.events[0]!.amount).toBe(80000);
    expect(eventsJson.events[0]!.accountNumber).toBe('****8777');
    expect(eventsJson.events[0]!.amountWords).toBe('tám mươi nghìn');
    expect(eventsJson.events[0]!.speechText).toBe('Đã nhận tám mươi nghìn đồng');

    // Polling with nextCursor returns no duplicates
    const eventsAgainResp = await app.fetch(
      new Request(
        `https://pay.comey.test/api/soundbox/${created.kioskToken}/events?since=${encodeURIComponent(
          eventsJson.nextCursor
        )}`
      ),
      env
    );
    expect(eventsAgainResp.status).toBe(200);
    const eventsAgainJson = (await eventsAgainResp.json()) as { events: unknown[] };
    expect(eventsAgainJson.events).toHaveLength(0);

    // Rotate kiosk token invalidates old token immediately
    const rotateResp = await app.fetch(
      new Request(`https://pay.comey.test/v1/soundboxes/${created.soundbox.id}/rotate-token`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://pay.comey.test' },
      }),
      env
    );
    expect(rotateResp.status).toBe(200);
    const rotated = (await rotateResp.json()) as { kioskToken: string };
    expect(rotated.kioskToken).not.toBe(created.kioskToken);

    const oldTokenResp = await app.fetch(
      new Request(`https://pay.comey.test/api/soundbox/${created.kioskToken}/events`),
      env
    );
    expect(oldTokenResp.status).toBe(404);

    const newTokenResp = await app.fetch(
      new Request(`https://pay.comey.test/api/soundbox/${rotated.kioskToken}/events`),
      env
    );
    expect(newTokenResp.status).toBe(200);

    // Disabling soundbox blocks polling with uniform 404 (no existence/name leak)
    const patchResp = await app.fetch(
      new Request(`https://pay.comey.test/v1/soundboxes/${created.soundbox.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: 'https://pay.comey.test',
        },
        body: JSON.stringify({ enabled: false }),
      }),
      env
    );
    expect(patchResp.status).toBe(200);

    const disabledPollResp = await app.fetch(
      new Request(`https://pay.comey.test/api/soundbox/${rotated.kioskToken}/events`),
      env
    );
    expect(disabledPollResp.status).toBe(404);
  }, 20_000);
});
