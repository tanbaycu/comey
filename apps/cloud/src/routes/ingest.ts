import { sha256Hex, type RawEmailInput } from '@comey/core';
import { Hono } from 'hono';
import type { BankAccountRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { checkRateLimit, getClientIp } from '../middleware/rateLimit.js';
import { ingestRawEmailForAccount } from '../services/ingest.js';

const MAX_APPS_SCRIPT_BODY_BYTES = 256 * 1024; // 256 KiB cap (MED-2)

export function createIngestRoutes(options?: {
  webhookFetch?: typeof fetch;
}): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();

  app.post('/apps-script', async (c) => {
    const ip = getClientIp(c);
    const rl = await checkRateLimit(c.env.DB, `ingest_as:${ip}`, 120, 60);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      return c.json({ ok: false, error: 'Too many ingest requests' }, 429);
    }

    const contentLengthRaw = c.req.header('content-length');
    const contentLength = contentLengthRaw ? Number.parseInt(contentLengthRaw, 10) : 0;
    if (Number.isFinite(contentLength) && contentLength > MAX_APPS_SCRIPT_BODY_BYTES) {
      return c.json({ ok: false, error: 'Payload exceeds 256KB limit' }, 413);
    }

    const authHeader = c.req.header('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : (c.req.header('x-comey-ingest-secret') || '').trim();

    if (!token) {
      return c.json({ ok: false, error: 'Missing Apps Script token' }, 401);
    }

    const tokenHash = await sha256Hex(token);
    const account = await c.env.DB.prepare(
      `SELECT * FROM bank_accounts WHERE apps_script_token_hash = ? AND enabled = 1`
    )
      .bind(tokenHash)
      .first<BankAccountRow>();

    if (!account) {
      return c.json({ ok: false, error: 'Invalid Apps Script token' }, 401);
    }

    let rawText: string;
    try {
      rawText = await c.req.text();
    } catch {
      return c.json({ ok: false, error: 'Invalid request body' }, 400);
    }

    if (new TextEncoder().encode(rawText).byteLength > MAX_APPS_SCRIPT_BODY_BYTES) {
      return c.json({ ok: false, error: 'Payload exceeds 256KB limit' }, 413);
    }

    let body: Partial<RawEmailInput> | null = null;
    try {
      body = JSON.parse(rawText) as Partial<RawEmailInput>;
    } catch {
      body = null;
    }

    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON payload' }, 400);
    }

    const rawEmail: RawEmailInput = {
      source: 'apps_script',
      messageId: body.messageId,
      from: String(body.from || ''),
      to: body.to,
      subject: body.subject,
      date: body.date,
      htmlBody: body.htmlBody,
      textBody: body.textBody,
      headers: body.headers,
      authenticationResults: body.authenticationResults,
    };

    let ctx: Pick<ExecutionContext, 'waitUntil'> | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = undefined;
    }

    const result = await ingestRawEmailForAccount(envOrThrow(c), ctx, account, rawEmail, {
      syncWebhooks: !ctx,
      fetchImpl: options?.webhookFetch,
    });

    if (result.status === 'parsed') {
      return c.json({
        ok: true,
        status: 'parsed',
        matched: Boolean(result.matchedOrderCode || result.deliveries.length > 0),
        retry: false,
        transactionId: result.transaction.id,
        matchedOrderCode: result.matchedOrderCode,
      });
    }

    if (result.status === 'duplicate') {
      return c.json({
        ok: true,
        status: 'duplicate',
        matched: true,
        retry: false,
        transactionId: result.transactionId,
      });
    }

    return c.json({
      ok: true,
      status: result.status,
      matched: false,
      retry: false,
    });
  });

  return app;
}

function envOrThrow(c: { env: AppContextEnv['Bindings'] }) {
  return c.env;
}
