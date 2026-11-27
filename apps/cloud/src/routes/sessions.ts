import {
  cancelSession,
  createPaymentSession,
  createVietQR,
  encryptSecret,
  randomBase64Url,
} from '@comey/core';
import { Hono } from 'hono';
import {
  rowToPaymentSession,
  type BankAccountRow,
  type PaymentSessionRow,
} from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { requireScope, requireWorkspaceAuth } from '../middleware/auth.js';
import { validateSafeOutboundUrl } from '../security/urlGuard.js';

const MIN_SESSION_TTL_SECONDS = 60;
const MAX_SESSION_TTL_SECONDS = 86_400;
const DEFAULT_SESSION_TTL_SECONDS = 900;

export function createSessionRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();
  app.use('*', requireWorkspaceAuth);

  app.get('/', requireScope('sessions:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const isTestKey = c.get('isTestKey');
    const status = c.req.query('status');
    const limitRaw = Number.parseInt(c.req.query('limit') || '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    const clauses: string[] = ['workspace_id = ?'];
    const params: Array<string | number> = [workspaceId];

    // CRIT-3: Sandbox keys can only list test sessions (is_test = 1)
    if (isTestKey) {
      clauses.push('is_test = 1');
    }
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    params.push(limit);

    const rows = await c.env.DB.prepare(
      `SELECT * FROM payment_sessions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
    )
      .bind(...params)
      .all<PaymentSessionRow>();

    return c.json({
      ok: true,
      sessions: rows.results.map(rowToPaymentSession),
    });
  });

  app.post('/', requireScope('sessions:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const isTestKey = c.get('isTestKey');
    const body = (await c.req.json().catch(() => null)) as {
      bankAccountId?: string;
      orderCode?: string;
      amount?: number;
      exactMatchOnly?: boolean;
      ttlSeconds?: number;
      webhookUrl?: string;
      webhookSecret?: string;
      returnUrl?: string;
      isTest?: boolean;
      metadata?: Record<string, unknown>;
    } | null;

    const bankAccountId = String(body?.bankAccountId || '').trim();
    const orderCode = String(body?.orderCode || '').trim();
    const amount = Math.floor(Number(body?.amount || 0));

    if (!bankAccountId) {
      return c.json({ ok: false, error: 'bankAccountId is required' }, 400);
    }
    if (!orderCode || orderCode.length > 64) {
      return c.json({ ok: false, error: 'orderCode là bắt buộc (tối đa 64 ký tự)' }, 400);
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      return c.json({ ok: false, error: 'amount phải là số nguyên dương <= 1.000.000.000đ' }, 400);
    }
    if (body?.webhookUrl) {
      const whCheck = validateSafeOutboundUrl(body.webhookUrl);
      if (!whCheck.ok) {
        return c.json({ ok: false, error: whCheck.reason }, 400);
      }
    }
    // MED-3: Do NOT allow SANDBOX_WEBHOOK_URL on returnUrl
    if (body?.returnUrl) {
      const retCheck = validateSafeOutboundUrl(body.returnUrl);
      if (!retCheck.ok) {
        return c.json({ ok: false, error: `returnUrl không hợp lệ: ${retCheck.reason}` }, 400);
      }
    }

    const account = await c.env.DB.prepare(
      `SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ? AND enabled = 1`
    )
      .bind(bankAccountId, workspaceId)
      .first<BankAccountRow>();

    if (!account) {
      return c.json({ ok: false, error: 'Bank account not found or disabled' }, 404);
    }

    // MED-4: Clamp ttlSeconds strictly within [60, 86400] to prevent invalid Date RangeError
    const rawTtl = body?.ttlSeconds;
    const ttlSeconds =
      rawTtl !== undefined && Number.isFinite(Number(rawTtl))
        ? Math.max(
            MIN_SESSION_TTL_SECONDS,
            Math.min(MAX_SESSION_TTL_SECONDS, Math.floor(Number(rawTtl)))
          )
        : DEFAULT_SESSION_TTL_SECONDS;

    // CRIT-3: cm_test_ API keys always create isolated test sessions (is_test = 1)
    const isTestSession = isTestKey || Boolean(body?.isTest);

    const session = createPaymentSession({
      orderCode,
      bankCode: account.bank_code,
      bankBin: account.bank_bin,
      accountNumber: account.account_number,
      accountName: account.account_name,
      expectedAmount: amount,
      exactMatchOnly: body?.exactMatchOnly,
      ttlSeconds,
      metadata: body?.metadata,
    });

    let webhookSecretPlain: string | undefined;
    let webhookSecretEnc: string | null = null;
    if (body?.webhookUrl) {
      webhookSecretPlain =
        String(body.webhookSecret || '').trim() || `whsec_${randomBase64Url(24)}`;
      webhookSecretEnc = await encryptSecret(
        webhookSecretPlain,
        c.env.MASTER_ENCRYPTION_KEY
      );
    }

    await c.env.DB.prepare(
      `INSERT INTO payment_sessions (
        id, workspace_id, bank_account_id, short_id, order_code,
        bank_code, bank_bin, account_number, account_name,
        expected_amount, received_amount, exact_match_only, status,
        overpaid, excess_amount, missing_amount,
        webhook_url, webhook_secret_enc, return_url, metadata_json,
        expires_at, is_test, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        session.id,
        workspaceId,
        account.id,
        session.shortId,
        session.orderCode,
        session.bankCode,
        session.bankBin,
        session.accountNumber,
        session.accountName,
        session.expectedAmount,
        session.exactMatchOnly ? 1 : 0,
        session.missingAmount,
        body?.webhookUrl ? String(body.webhookUrl).trim() : null,
        webhookSecretEnc,
        body?.returnUrl ? String(body.returnUrl).trim() : null,
        session.metadata ? JSON.stringify(session.metadata) : null,
        session.expiresAt,
        isTestSession ? 1 : 0,
        session.createdAt,
        session.updatedAt
      )
      .run();

    const qr = createVietQR({
      bankBin: session.bankBin,
      accountNumber: session.accountNumber,
      amount: session.expectedAmount,
      transferNote: session.orderCode,
    });

    const baseUrl = String(c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(
      /\/$/,
      ''
    );

    return c.json(
      {
        ok: true,
        session: {
          ...session,
          bankAccountId: account.id,
          isTest: isTestSession,
        },
        checkoutUrl: `${baseUrl}/p/${session.shortId}`,
        qrPngUrl: `${baseUrl}/p/${session.shortId}/qr.png`,
        vietqr: {
          emvco: qr.emvco,
          svg: qr.svg,
        },
        ...(webhookSecretPlain ? { webhookSecret: webhookSecretPlain } : {}),
      },
      201
    );
  });

  app.get('/:id', requireScope('sessions:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const isTestKey = c.get('isTestKey');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT * FROM payment_sessions WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<PaymentSessionRow>();

    if (!row) {
      return c.json({ ok: false, error: 'Payment session not found' }, 404);
    }
    if (isTestKey && row.is_test !== 1) {
      return c.json(
        { ok: false, error: 'Sandbox API key cannot read live payment sessions' },
        403
      );
    }
    return c.json({ ok: true, session: rowToPaymentSession(row) });
  });

  app.post('/:id/cancel', requireScope('sessions:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const isTestKey = c.get('isTestKey');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT * FROM payment_sessions WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<PaymentSessionRow>();

    if (!row) {
      return c.json({ ok: false, error: 'Payment session not found' }, 404);
    }
    if (isTestKey && row.is_test !== 1) {
      return c.json(
        { ok: false, error: 'Sandbox API key cannot cancel live payment sessions' },
        403
      );
    }

    const res = cancelSession(rowToPaymentSession(row));
    if (!res.cancelled) {
      return c.json(
        { ok: false, error: `Cannot cancel session in status '${row.status}'` },
        409
      );
    }

    await c.env.DB.prepare(
      `UPDATE payment_sessions
       SET status = 'cancelled', cancelled_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(res.session.cancelledAt!, res.session.updatedAt, id, workspaceId)
      .run();

    return c.json({
      ok: true,
      session: {
        ...res.session,
        bankAccountId: row.bank_account_id,
        isTest: row.is_test === 1,
      },
    });
  });

  return app;
}
