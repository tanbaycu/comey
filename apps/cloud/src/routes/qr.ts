import {
  createVietQR,
  getBankMetadata,
  listSupportedBanks,
} from '@comey/core';
import { Hono } from 'hono';
import type { AppContextEnv } from '../env.js';
import { checkLocalRateLimit, getClientIp } from '../middleware/rateLimit.js';

const BANK_ALIASES: Record<string, string> = {
  TCB: 'TECHCOMBANK',
  MBBANK: 'MB',
  VIETCOMBANK: 'VCB',
  TPB: 'TPBANK',
  VPB: 'VPBANK',
  STB: 'SACOMBANK',
  CTG: 'VIETINBANK',
  ICB: 'VIETINBANK',
  CAKEBYVPBANK: 'CAKE',
};

const MAX_QR_AMOUNT_VND = 500_000_000_000;

export function resolveBankForQr(rawBank: string): {
  bin: string;
  code: string;
  name: string;
} | null {
  const trimmed = String(rawBank || '').trim();
  if (!trimmed) return null;

  const upperCompact = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mappedCode = BANK_ALIASES[upperCompact] || upperCompact;

  const direct = getBankMetadata(mappedCode) ?? getBankMetadata(trimmed);
  if (direct) {
    return { bin: direct.bin, code: direct.code, name: direct.name };
  }

  for (const bank of listSupportedBanks()) {
    const shortCompact = bank.shortName.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (
      bank.code.toUpperCase() === mappedCode ||
      bank.bin === trimmed ||
      shortCompact === mappedCode
    ) {
      return { bin: bank.bin, code: bank.code, name: bank.name };
    }
  }

  if (/^\d{6}$/.test(trimmed)) {
    return { bin: trimmed, code: trimmed, name: trimmed };
  }

  return null;
}

export function createDynamicQrRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();

  app.get('/', async (c) => {
    const ip = getClientIp(c);
    const rl = checkLocalRateLimit(c.env.DB, `public_qr:${ip}`, 120, 60_000);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      return c.json({ ok: false, error: 'Too many QR requests' }, 429);
    }

    const rawBank = c.req.query('bank') || '';
    const bank = resolveBankForQr(rawBank);
    if (!bank) {
      return c.json(
        {
          ok: false,
          error:
            'Tham số bank không hợp lệ. Hỗ trợ CAKE, MB, VCB, TECHCOMBANK, TIMO, ACB, TPBANK, VIB, VPBANK, SACOMBANK, BIDV, VIETINBANK hoặc mã BIN 6 số.',
        },
        400
      );
    }

    const rawAccount = (
      c.req.query('acc') ||
      c.req.query('account') ||
      c.req.query('accountNumber') ||
      ''
    ).trim();
    if (!/^[A-Za-z0-9]{4,24}$/.test(rawAccount)) {
      return c.json(
        {
          ok: false,
          error: 'Tham số acc (số tài khoản 4-24 ký tự chữ/số) không hợp lệ.',
        },
        400
      );
    }

    const rawAmount = (c.req.query('amount') || '').trim();
    let amount: number | undefined;
    if (rawAmount !== '') {
      if (!/^\d{1,12}$/.test(rawAmount)) {
        return c.json({ ok: false, error: 'Tham số amount phải là số nguyên dương VND.' }, 400);
      }
      const parsed = Number(rawAmount);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_QR_AMOUNT_VND) {
        return c.json(
          { ok: false, error: `Số tiền không hợp lệ (1 - ${MAX_QR_AMOUNT_VND} VND).` },
          400
        );
      }
      amount = parsed;
    }

    const rawDes = (c.req.query('des') || c.req.query('note') || c.req.query('content') || '')
      .trim()
      .slice(0, 99);

    const rawFormat = (c.req.query('format') || 'png').trim().toLowerCase();
    if (rawFormat !== 'png' && rawFormat !== 'svg') {
      return c.json({ ok: false, error: 'Tham số format chỉ hỗ trợ png hoặc svg.' }, 400);
    }

    try {
      const edgeCache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
      if (edgeCache) {
        const cached = await edgeCache.match(c.req.url);
        if (cached) {
          return cached;
        }
      }
    } catch {
      // Ignore Cache API errors in non-edge environments
    }

    const qr = createVietQR({
      bankBin: bank.bin,
      accountNumber: rawAccount,
      amount,
      transferNote: rawDes || undefined,
      lightColor: '#FFFFFF',
    });

    let response: Response;
    if (rawFormat === 'svg') {
      response = new Response(qr.svg, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } else {
      const pngBytes = qr.toPngBytes({ scale: 8, margin: 4 });
      const pngCopy = new Uint8Array(pngBytes.byteLength);
      pngCopy.set(pngBytes);
      response = new Response(pngCopy.slice().buffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    try {
      const edgeCache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
      if (edgeCache) {
        const putPromise = edgeCache.put(c.req.url, response.clone()).catch(() => {});
        try {
          c.executionCtx.waitUntil(putPromise);
        } catch {
          // Ignore when outside Workers runtime
        }
      }
    } catch {
      // Ignore Cache API errors
    }

    return response;
  });

  return app;
}
