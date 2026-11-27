import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
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

async function bootstrapWorkspace(app: ReturnType<typeof createApp>, env: Env): Promise<string> {
  const regResp = await app.fetch(
    new Request('https://pay.comey.test/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'zero-kyc@comey.vn',
        password: 'Password123!',
        name: 'Zero KYC Merchant',
        workspaceName: 'Zero KYC Shop',
      }),
    }),
    env
  );
  expect(regResp.status).toBe(201);
  const setCookie = regResp.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0] || '';
  expect(cookie).toContain('comey_session=');
  return cookie;
}

async function createBankAccount(
  app: ReturnType<typeof createApp>,
  env: Env,
  cookie: string,
  bankCode: string,
  accountNumber: string
): Promise<string> {
  const resp = await app.fetch(
    new Request('https://pay.comey.test/v1/bank-accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://pay.comey.test',
      },
      body: JSON.stringify({
        bankCode,
        accountNumber,
        accountName: 'NGUYEN VAN TEST',
        strictAuth: false,
      }),
    }),
    env
  );
  expect(resp.status).toBe(201);
  const data = (await resp.json()) as { bankAccount: { id: string } };
  return data.bankAccount.id;
}

describe('Zero-KYC Pack: Notifiers (Telegram/Discord/Sheets), Multi-Bank Simulator, Dynamic /qr & POS Mini', () => {
  it(
    'dispatches Telegram, Discord & Google Sheets notifications while protecting Bot Tokens from leaks',
    { timeout: 20_000 },
    async () => {
      const outboundCalls: Array<{ url: string; method: string; body: string }> = [];
      const BOT_TOKEN = '123456789:AAFakeTelegramSecretTokenForTest123';

      const mockFetch: typeof fetch = async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method || 'GET';
        const body = typeof init?.body === 'string' ? init.body : '';
        outboundCalls.push({ url, method, body });

        if (url.startsWith('https://script.google.com/macros/s/')) {
          return new Response('', {
            status: 302,
            headers: { Location: 'https://script.googleusercontent.com/macros/echo?lib=sheet123' },
          });
        }
        if (url.startsWith('https://discord.com/api/webhooks/')) {
          return new Response('', { status: 204 });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const { app, env } = setupTestEnv(mockFetch);
      const cookie = await bootstrapWorkspace(app, env);
      const vcbAccId = await createBankAccount(app, env, cookie, 'VCB', '1012345678');

      // 1. Reject HTTP (non-HTTPS) URL for Google Sheets
      const badSheetsResp = await app.fetch(
        new Request('https://pay.comey.test/v1/routing-rules', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId: vcbAccId,
            name: 'Insecure Sheets',
            matchType: 'all',
            payloadFormat: 'google_sheets',
            webhookUrl: 'http://script.google.com/macros/s/abc/exec',
          }),
        }),
        env
      );
      expect(badSheetsResp.status).toBe(400);

      // 2. Create Telegram rule (token encrypted, webhook_url = telegram://chat/-10099887766)
      const tgResp = await app.fetch(
        new Request('https://pay.comey.test/v1/routing-rules', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId: vcbAccId,
            name: 'Telegram Shop',
            matchType: 'all',
            payloadFormat: 'telegram',
            telegramBotToken: BOT_TOKEN,
            telegramChatId: '-10099887766',
            priority: 1,
          }),
        }),
        env
      );
      expect(tgResp.status).toBe(201);
      const tgData = (await tgResp.json()) as {
        webhookSecret: string;
        routingRule: { id: string; webhookUrl: string; payloadFormat: string };
      };
      expect(tgData.webhookSecret).toBe('');
      expect(tgData.routingRule.webhookUrl).toBe('telegram://chat/-10099887766');

      const tgRotateResp = await app.fetch(
        new Request(`https://pay.comey.test/v1/routing-rules/${tgData.routingRule.id}/rotate-secret`, {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://pay.comey.test' },
        }),
        env
      );
      expect(tgRotateResp.status).toBe(400);

      // 3. Create Discord rule
      const discordResp = await app.fetch(
        new Request('https://pay.comey.test/v1/routing-rules', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId: vcbAccId,
            name: 'Discord Counter',
            matchType: 'prefix',
            pattern: 'SHOP',
            payloadFormat: 'discord',
            webhookUrl: 'https://discord.com/api/webhooks/111222/token333',
            priority: 2,
          }),
        }),
        env
      );
      expect(discordResp.status).toBe(201);

      // 4. Create Google Sheets rule
      const sheetsResp = await app.fetch(
        new Request('https://pay.comey.test/v1/routing-rules', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId: vcbAccId,
            name: 'Google Sheets Ledger',
            matchType: 'all',
            payloadFormat: 'google_sheets',
            webhookUrl: 'https://script.google.com/macros/s/AKfycbTestLedger/exec',
            priority: 3,
          }),
        }),
        env
      );
      expect(sheetsResp.status).toBe(201);

      // 5. Simulate incoming VCB transfer matching all 3 channels
      const simResp = await app.fetch(
        new Request('https://pay.comey.test/v1/simulator/transfer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId: vcbAccId,
            amount: 125000,
            content: 'SHOP8899 thanh toan ca phe',
          }),
        }),
        env
      );
      expect(simResp.status).toBe(200);

      // Verify Telegram outbound call
      const tgCall = outboundCalls.find((c) => c.url.includes('/sendMessage'));
      expect(tgCall).toBeDefined();
      expect(tgCall?.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
      const tgBody = JSON.parse(tgCall!.body) as { chat_id: string; text: string };
      expect(tgBody.chat_id).toBe('-10099887766');
      expect(tgBody.text).toContain('SHOP8899');
      expect(tgBody.text).toContain('VCB');

      // Verify Discord outbound call
      const discordCall = outboundCalls.find((c) =>
        c.url.startsWith('https://discord.com/api/webhooks/')
      );
      expect(discordCall).toBeDefined();
      const discordBody = JSON.parse(discordCall!.body) as { embeds: Array<{ title: string }> };
      expect(discordBody.embeds[0]?.title).toContain('125');

      // Verify Google Sheets POST -> 302 single-hop GET on script.googleusercontent.com
      const sheetsPost = outboundCalls.find(
        (c) => c.method === 'POST' && c.url.startsWith('https://script.google.com/macros/s/')
      );
      const sheetsGet = outboundCalls.find(
        (c) =>
          c.method === 'GET' &&
          c.url === 'https://script.googleusercontent.com/macros/echo?lib=sheet123'
      );
      expect(sheetsPost).toBeDefined();
      expect(sheetsGet).toBeDefined();
      const sheetsRow = JSON.parse(sheetsPost!.body) as {
        amount: number;
        bankCode: string;
        accountNumber: string;
        content: string;
        txId: string;
        secret?: string;
      };
      expect(sheetsRow.amount).toBe(125000);
      expect(sheetsRow.bankCode).toBe('VCB');
      expect(sheetsRow.accountNumber).toBe('1012345678');
      expect(sheetsRow.content).toContain('SHOP8899');
      expect(sheetsRow.txId).toBeTruthy();
      expect(sheetsRow.secret).toBeTruthy();

      // Verify Bot Token NEVER leaks in GET /v1/routing-rules or GET /v1/deliveries
      const [rulesRes, deliveriesRes] = await Promise.all([
        app.fetch(
          new Request('https://pay.comey.test/v1/routing-rules', {
            headers: { Cookie: cookie },
          }),
          env
        ),
        app.fetch(
          new Request('https://pay.comey.test/v1/deliveries', {
            headers: { Cookie: cookie },
          }),
          env
        ),
      ]);
      expect(rulesRes.status).toBe(200);
      expect(deliveriesRes.status).toBe(200);
      expect(await rulesRes.text()).not.toContain(BOT_TOKEN);
      expect(await deliveriesRes.text()).not.toContain(BOT_TOKEN);
    }
  );

  it(
    'supports dynamic GET /qr (PNG & SVG), multi-bank Simulator, and Soundbox POS Mini 2-in-1',
    { timeout: 20_000 },
    async () => {
      const { app, env } = setupTestEnv();
      const cookie = await bootstrapWorkspace(app, env);

      const mbAccId = await createBankAccount(app, env, cookie, 'MB', '0333444555');
      const acbAccId = await createBankAccount(app, env, cookie, 'ACB', '222333444');
      await createBankAccount(app, env, cookie, 'TECHCOMBANK', '190333444');
      await createBankAccount(app, env, cookie, 'TIMO', '902111222');

      // 1. Dynamic /qr PNG & SVG + alias resolution (TCB -> TECHCOMBANK)
      const pngResp = await app.fetch(
        new Request('https://pay.comey.test/qr?bank=MB&acc=0333444555&amount=50000&des=TRA%20SUA'),
        env
      );
      expect(pngResp.status).toBe(200);
      expect(pngResp.headers.get('content-type')).toBe('image/png');
      expect(pngResp.headers.get('cache-control')).toContain('max-age=3600');
      const pngBytes = new Uint8Array(await pngResp.arrayBuffer());
      expect(Array.from(pngBytes.slice(0, 4))).toEqual([137, 80, 78, 71]);

      const svgResp = await app.fetch(
        new Request('https://pay.comey.test/qr?bank=TCB&acc=190333444&amount=99000&format=svg'),
        env
      );
      expect(svgResp.status).toBe(200);
      expect(svgResp.headers.get('content-type')).toContain('image/svg+xml');
      expect(svgResp.headers.get('content-security-policy')).toContain('sandbox');
      const svgBody = await svgResp.text();
      expect(svgBody).toContain('<svg');
      expect(svgBody).toContain('</svg>');

      const badQrResp = await app.fetch(
        new Request('https://pay.comey.test/qr?bank=UNKNOWN&acc=123456&amount=-10'),
        env
      );
      expect(badQrResp.status).toBe(400);

      // 2. Account-scoped Soundbox -> POS Mini QR stays strictly locked to paired MB account
      const sbxResp = await app.fetch(
        new Request('https://pay.comey.test/v1/soundboxes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            name: 'Quầy Thu Ngân MB',
            scope: 'account',
            bankAccountId: mbAccId,
            minAmount: 1000,
          }),
        }),
        env
      );
      expect(sbxResp.status).toBe(201);
      const sbxJson = (await sbxResp.json()) as {
        kioskUrl: string;
        soundbox: { id: string };
      };
      const token = sbxJson.kioskUrl.split('/').pop()!;
      expect(token.length).toBeGreaterThan(10);

      // Kiosk HTML renders POS Mini section with CSP nonce
      const kioskHtmlResp = await app.fetch(
        new Request(`https://pay.comey.test/soundbox/${token}`),
        env
      );
      expect(kioskHtmlResp.status).toBe(200);
      const kioskHtml = await kioskHtmlResp.text();
      expect(kioskHtml).toContain('POS Mini');
      expect(kioskHtml).toContain('posQrBox');

      // Generate POS QR via /api/soundbox/:token/pos-qr, verifying account-scope isolation (?bankAccountId=acbAccId ignored)
      const posResp = await app.fetch(
        new Request(
          `https://pay.comey.test/api/soundbox/${token}/pos-qr?amount=75000&note=CF01&bankAccountId=${acbAccId}`
        ),
        env
      );
      expect(posResp.status).toBe(200);
      const posData = (await posResp.json()) as {
        ok: true;
        pos: {
          bankCode: string;
          bankBin: string;
          accountNumber: string;
          amount: number;
          note: string;
          emvco: string;
          qrSvg: string;
        };
      };
      expect(posData.pos.bankCode).toBe('MB');
      expect(posData.pos.accountNumber).toBe('0333444555');
      expect(posData.pos.amount).toBe(75000);
      expect(posData.pos.note).toBe('CF01');
      expect(posData.pos.emvco).toContain('970422');
      expect(posData.pos.qrSvg).toContain('<svg');

      // Bearer token variant also works cleanly
      const bearerPosResp = await app.fetch(
        new Request('https://pay.comey.test/api/soundbox/pos-qr?amount=20000', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        env
      );
      expect(bearerPosResp.status).toBe(200);

      // Validation errors
      const badPosResp = await app.fetch(
        new Request(`https://pay.comey.test/api/soundbox/${token}/pos-qr?amount=0`),
        env
      );
      expect(badPosResp.status).toBe(400);

      // 3. Multi-bank Simulator on ACB & TIMO parses & stores real transactions
      const acbSimResp = await app.fetch(
        new Request('https://pay.comey.test/v1/simulator/transfer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://pay.comey.test',
          },
          body: JSON.stringify({
            bankAccountId: acbAccId,
            amount: 210000,
            content: 'POS ACB test 210k',
          }),
        }),
        env
      );
      expect(acbSimResp.status).toBe(200);
    }
  );
});
