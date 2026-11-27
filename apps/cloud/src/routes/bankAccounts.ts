import { generateAppsScriptCode } from '@comey/apps-script';
import {
  encryptSecret,
  getBankMetadata,
  randomBase64Url,
  randomHex,
  sha256Hex,
} from '@comey/core';
import { Hono } from 'hono';
import type { BankAccountRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { requireLiveAuth, requireScope, requireWorkspaceAuth } from '../middleware/auth.js';
import { getClientIp } from '../middleware/rateLimit.js';
import { validateAppsScriptUrl } from '../security/urlGuard.js';
import { recordAuditLog } from '../services/audit.js';

function sanitizeBankAccount(row: BankAccountRow, inboundDomain: string) {
  return {
    id: row.id,
    bankCode: row.bank_code,
    bankBin: row.bank_bin,
    accountNumber: row.account_number,
    accountName: row.account_name,
    inboundAlias: row.inbound_alias,
    inboundEmail: `${row.inbound_alias}@${inboundDomain}`,
    appsScriptUrl: row.apps_script_url,
    forwardingStatus: row.forwarding_status,
    forwardingConfirmCode: row.forwarding_confirm_code,
    forwardingConfirmUrl: row.forwarding_confirm_url,
    forwardingRequesterEmail: row.forwarding_requester_email,
    strictAuth: row.strict_auth === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBankAccountRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();
  app.use('*', requireWorkspaceAuth);

  app.get('/', requireScope('accounts:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const rows = await c.env.DB.prepare(
      `SELECT * FROM bank_accounts WHERE workspace_id = ? ORDER BY created_at DESC`
    )
      .bind(workspaceId)
      .all<BankAccountRow>();

    return c.json({
      ok: true,
      bankAccounts: rows.results.map((r) =>
        sanitizeBankAccount(r, c.env.INBOUND_EMAIL_DOMAIN)
      ),
    });
  });

  app.post('/', requireLiveAuth, requireScope('accounts:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const body = (await c.req.json().catch(() => null)) as {
      bankCode?: string;
      accountNumber?: string;
      accountName?: string;
      strictAuth?: boolean;
      appsScriptUrl?: string;
      appsScriptSecret?: string;
    } | null;

    const meta = getBankMetadata(body?.bankCode || 'CAKE');
    if (!meta) {
      return c.json({ ok: false, error: 'Unsupported bankCode' }, 400);
    }

    const accountNumber = String(body?.accountNumber || '').replace(/\D/g, '');
    const accountName = String(body?.accountName || '').trim().toUpperCase();
    if (accountNumber.length < 4) {
      return c.json({ ok: false, error: 'Valid accountNumber is required' }, 400);
    }
    if (!accountName) {
      return c.json({ ok: false, error: 'accountName is required' }, 400);
    }

    const id = `ba_${randomHex(10)}`;
    const inboundAlias = `in_${meta.code.toLowerCase()}_${randomHex(6)}`;
    const appsScriptToken = `cm_as_${randomBase64Url(24)}`;
    const appsScriptTokenHash = await sha256Hex(appsScriptToken);
    const strictAuth = body?.strictAuth === false ? 0 : 1;
    const appsScriptUrl = body?.appsScriptUrl ? String(body.appsScriptUrl).trim() : null;
    if (appsScriptUrl) {
      const asCheck = validateAppsScriptUrl(appsScriptUrl);
      if (!asCheck.ok) {
        return c.json({ ok: false, error: asCheck.reason }, 400);
      }
    }
    const appsScriptSecretEnc = body?.appsScriptSecret
      ? await encryptSecret(String(body.appsScriptSecret).trim(), c.env.MASTER_ENCRYPTION_KEY)
      : null;

    const nowIso = new Date().toISOString();

    try {
      await c.env.DB.prepare(
        `INSERT INTO bank_accounts (
          id, workspace_id, bank_code, bank_bin, account_number, account_name,
          inbound_alias, apps_script_token_hash, apps_script_url, apps_script_secret_enc,
          forwarding_status, strict_auth, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?)`
      )
        .bind(
          id,
          workspaceId,
          meta.code,
          meta.bin,
          accountNumber,
          accountName,
          inboundAlias,
          appsScriptTokenHash,
          appsScriptUrl,
          appsScriptSecretEnc,
          strictAuth,
          nowIso,
          nowIso
        )
        .run();
    } catch {
      return c.json(
        { ok: false, error: 'Bank account already exists in this workspace' },
        409
      );
    }

    const created = await c.env.DB.prepare(`SELECT * FROM bank_accounts WHERE id = ?`)
      .bind(id)
      .first<BankAccountRow>();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'bank_account.created',
      resourceType: 'bank_account',
      resourceId: id,
      ip: getClientIp(c),
      meta: { bankCode: meta.code },
    });

    return c.json(
      {
        ok: true,
        bankAccount: sanitizeBankAccount(created!, c.env.INBOUND_EMAIL_DOMAIN),
        appsScriptToken,
      },
      201
    );
  });

  app.patch('/:id', requireLiveAuth, requireScope('accounts:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<BankAccountRow>();

    if (!existing) {
      return c.json({ ok: false, error: 'Bank account not found' }, 404);
    }

    const body = (await c.req.json().catch(() => null)) as {
      accountName?: string;
      strictAuth?: boolean;
      enabled?: boolean;
      appsScriptUrl?: string | null;
      appsScriptSecret?: string | null;
    } | null;

    const accountName =
      body?.accountName !== undefined
        ? String(body.accountName).trim().toUpperCase() || existing.account_name
        : existing.account_name;
    const strictAuth =
      body?.strictAuth !== undefined ? (body.strictAuth ? 1 : 0) : existing.strict_auth;
    const enabled =
      body?.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled;
    const appsScriptUrl =
      body?.appsScriptUrl !== undefined
        ? body.appsScriptUrl
          ? String(body.appsScriptUrl).trim()
          : null
        : existing.apps_script_url;
    if (appsScriptUrl && body?.appsScriptUrl !== undefined) {
      const asCheck = validateAppsScriptUrl(appsScriptUrl);
      if (!asCheck.ok) {
        return c.json({ ok: false, error: asCheck.reason }, 400);
      }
    }
    const appsScriptSecretEnc =
      body?.appsScriptSecret !== undefined
        ? body.appsScriptSecret
          ? await encryptSecret(
              String(body.appsScriptSecret).trim(),
              c.env.MASTER_ENCRYPTION_KEY
            )
          : null
        : existing.apps_script_secret_enc;

    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE bank_accounts
       SET account_name = ?, strict_auth = ?, enabled = ?,
           apps_script_url = ?, apps_script_secret_enc = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(
        accountName,
        strictAuth,
        enabled,
        appsScriptUrl,
        appsScriptSecretEnc,
        nowIso,
        id,
        workspaceId
      )
      .run();

    const updated = await c.env.DB.prepare(`SELECT * FROM bank_accounts WHERE id = ?`)
      .bind(id)
      .first<BankAccountRow>();

    return c.json({
      ok: true,
      bankAccount: sanitizeBankAccount(updated!, c.env.INBOUND_EMAIL_DOMAIN),
    });
  });

  app.post('/:id/rotate-apps-script-token', requireLiveAuth, requireScope('accounts:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const token = `cm_as_${randomBase64Url(24)}`;
    const hash = await sha256Hex(token);
    const nowIso = new Date().toISOString();

    const res = await c.env.DB.prepare(
      `UPDATE bank_accounts SET apps_script_token_hash = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(hash, nowIso, id, workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      return c.json({ ok: false, error: 'Bank account not found' }, 404);
    }
    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'bank_account.apps_script_token_rotated',
      resourceType: 'bank_account',
      resourceId: id,
      ip: getClientIp(c),
    });
    return c.json({ ok: true, appsScriptToken: token });
  });

  app.post('/:id/confirm-forwarding', requireLiveAuth, requireScope('accounts:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const nowIso = new Date().toISOString();

    const res = await c.env.DB.prepare(
      `UPDATE bank_accounts SET forwarding_status = 'verified', updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(nowIso, id, workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      return c.json({ ok: false, error: 'Bank account not found' }, 404);
    }
    return c.json({ ok: true, forwardingStatus: 'verified' });
  });

  app.get('/:id/apps-script', requireScope('accounts:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const mode = c.req.query('mode') === 'standalone' ? 'standalone' : 'cloud_bridge';
    const customWebhookUrl = c.req.query('webhookUrl')?.trim();

    const row = await c.env.DB.prepare(
      `SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<BankAccountRow>();

    if (!row) {
      return c.json({ ok: false, error: 'Bank account not found' }, 404);
    }

    const meta = getBankMetadata(row.bank_code);
    const baseUrl = String(c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(
      /\/$/,
      ''
    );
    const ingestUrl =
      mode === 'standalone' && customWebhookUrl
        ? customWebhookUrl
        : `${baseUrl}/v1/ingest/apps-script`;

    const code = generateAppsScriptCode({
      mode,
      ingestUrl,
      expectedAccountNo: row.account_number,
      bankDomains: meta?.emailDomains ?? ['cake.vn'],
    });

    return c.json({
      ok: true,
      mode,
      ingestUrl,
      code,
    });
  });

  app.delete('/:id', requireLiveAuth, requireScope('accounts:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT id FROM bank_accounts WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<{ id: string }>();

    if (!existing) {
      return c.json({ ok: false, error: 'Bank account not found' }, 404);
    }

    // SEC-H4: Disable any soundboxes bound to this bank account before deleting it
    // so ON DELETE SET NULL can never silently widen access to all workspace accounts.
    const nowIso = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE soundboxes SET enabled = 0, updated_at = ? WHERE bank_account_id = ? AND workspace_id = ?`
      ).bind(nowIso, id, workspaceId),
      c.env.DB.prepare(`DELETE FROM bank_accounts WHERE id = ? AND workspace_id = ?`).bind(
        id,
        workspaceId
      ),
    ]);

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'bank_account.deleted',
      resourceType: 'bank_account',
      resourceId: id,
      ip: getClientIp(c),
    });
    return c.json({ ok: true });
  });

  return app;
}
