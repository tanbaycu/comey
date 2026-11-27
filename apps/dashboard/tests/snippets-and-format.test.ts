import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyToClipboard,
  formatDateTime,
  formatRelativeExpiry,
  formatVnd,
} from '../src/lib/format.js';
import { buildIntegrationSnippet } from '../src/lib/snippets.js';

function extractNodeVerifier(code: string): (rawBody: string, sigHeader: string, secret: string) => boolean {
  const start = code.indexOf('function verifyComeySignature');
  const end = code.indexOf('\n\n// 1)');
  if (start === -1 || end === -1) {
    throw new Error('Could not locate verifyComeySignature in Node snippet');
  }
  const fnSource = code.slice(start, end);
  const cryptoShim = {
    createHmac,
    timingSafeEqual: (a: Buffer, b: Buffer) => {
      if (a.length !== b.length) {
        throw new RangeError('Input buffers must have the same byte length');
      }
      return a.equals(b);
    },
  };
  const factory = new Function('crypto', `${fnSource}; return verifyComeySignature;`) as (
    cryptoObj: typeof cryptoShim
  ) => (rawBody: string, sigHeader: string, secret: string) => boolean;
  return factory(cryptoShim);
}

describe('Dashboard Formatting & Clipboard Helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('formats VND amounts safely across positive, zero, fractional, and non-finite inputs', () => {
    expect(formatVnd(80000)).toContain('80');
    expect(formatVnd(80000)).toContain('đ');
    expect(formatVnd(0)).toBe('0 đ');
    expect(formatVnd(12500.9)).toContain('12');
    expect(formatVnd(Number.NaN)).toBe('0 đ');
    expect(formatVnd(Number.POSITIVE_INFINITY)).toBe('0 đ');
  });

  it('formats ISO timestamps and handles empty or invalid dates gracefully', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatDateTime('2026-11-26T10:15:00.000Z')).toMatch(/2026/);
  });

  it('formats relative expiry countdowns cleanly across minutes, hours, days, and expired', () => {
    const now = Date.parse('2026-11-26T10:00:00.000Z');
    expect(formatRelativeExpiry(null, now)).toBe('—');
    expect(formatRelativeExpiry('invalid', now)).toBe('—');
    expect(formatRelativeExpiry('2026-11-26T10:00:20.000Z', now)).toBe('Còn 1 phút');
    expect(formatRelativeExpiry('2026-11-26T10:15:00.000Z', now)).toBe('Còn 15 phút');
    expect(formatRelativeExpiry('2026-11-26T12:30:00.000Z', now)).toBe('Còn 2h 30m');
    expect(formatRelativeExpiry('2026-11-28T12:00:00.000Z', now)).toBe('Còn 2d 2h');
    expect(formatRelativeExpiry('2026-11-26T09:50:00.000Z', now)).toBe('Đã hết hạn');
  });

  it('returns boolean accurately from copyToClipboard on success, rejection, and missing API', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    await expect(copyToClipboard('hello')).resolves.toBe(true);

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });
    await expect(copyToClipboard('hello')).resolves.toBe(false);

    vi.stubGlobal('navigator', {});
    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });
});

describe('Integration Snippets Security Hardening', () => {
  it('hardens Node snippet with buffer length check before timingSafeEqual and verifies signatures safely', () => {
    const nodeCode = buildIntegrationSnippet('node', 'https://pay.comey.vn/');
    expect(nodeCode).toContain('https://pay.comey.vn/v1/sessions');
    expect(nodeCode).toContain('X-Comey-Signature');
    expect(nodeCode).toContain('expectedBuf.length !== sigBuf.length');
    expect(nodeCode).toContain('timingSafeEqual');

    const verify = extractNodeVerifier(nodeCode);
    const secret = 'whsec_test_12345';
    const rawBody = JSON.stringify({ type: 'session.paid', amount: 80000 });
    const ts = Math.floor(Date.now() / 1000);
    const validSig = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');

    expect(verify(rawBody, `t=${ts},v1=${validSig}`, secret)).toBe(true);
    // Mismatched length must return false without throwing RangeError
    expect(() => verify(rawBody, `t=${ts},v1=short`, secret)).not.toThrow();
    expect(verify(rawBody, `t=${ts},v1=short`, secret)).toBe(false);
    // Tampered payload fails
    expect(verify('{"tampered":true}', `t=${ts},v1=${validSig}`, secret)).toBe(false);
    // Expired or non-numeric timestamp fails cleanly
    expect(verify(rawBody, `t=${ts - 600},v1=${validSig}`, secret)).toBe(false);
    expect(verify(rawBody, `t=notanumber,v1=${validSig}`, secret)).toBe(false);
    expect(verify(rawBody, '', secret)).toBe(false);
  });

  it('hardens Python snippet with try/except (TypeError, ValueError) around int(ts)', () => {
    const pyCode = buildIntegrationSnippet('python', 'https://pay.comey.vn');
    expect(pyCode).toContain('try:');
    expect(pyCode).toContain('int(ts)');
    expect(pyCode).toContain('except (TypeError, ValueError):');
    expect(pyCode).toContain('hmac.compare_digest');
    expect(pyCode).toContain('https://pay.comey.vn/v1/transactions');
  });

  it('hardens PHP snippet with is_string($t) and is_string($v1) guards before hash_equals', () => {
    const phpCode = buildIntegrationSnippet('php', 'https://pay.comey.vn');
    expect(phpCode).toContain('HTTP_X_COMEY_SIGNATURE');
    expect(phpCode).toContain('is_string($t)');
    expect(phpCode).toContain('is_string($v1)');
    expect(phpCode).toContain('hash_equals');
  });

  it('generates Telegram grammY snippet with normalized origin', () => {
    const tgCode = buildIntegrationSnippet('telegram', 'https://pay.comey.vn/');
    expect(tgCode).toContain('grammy');
    expect(tgCode).toContain('https://pay.comey.vn/v1/sessions');
    expect(tgCode).toContain('qrPngUrl');
    expect(tgCode).toContain('checkoutUrl');
  });
});
