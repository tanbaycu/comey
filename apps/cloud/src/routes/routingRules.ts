import {
  encryptSecret,
  randomBase64Url,
  randomHex,
  WEBHOOK_PAYLOAD_FORMATS,
  type WebhookPayloadFormat,
} from '@comey/core';
import { Hono } from 'hono';
import type { BankAccountRow, RoutingRuleRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { requireLiveAuth, requireScope, requireWorkspaceAuth } from '../middleware/auth.js';
import { getClientIp } from '../middleware/rateLimit.js';
import {
  isSandboxWebhookUrl,
  isTelegramTargetUrl,
  parseTelegramChatId,
  TELEGRAM_URL_PREFIX,
  validateSafeOutboundUrl,
  validateSafeRegexPattern,
} from '../security/urlGuard.js';
import { recordAuditLog } from '../services/audit.js';

const TELEGRAM_BOT_TOKEN_REGEX = /^\d{4,20}:[A-Za-z0-9_-]{16,120}$/;

function sanitizeRule(row: RoutingRuleRow) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    name: row.name,
    enabled: row.enabled === 1,
    priority: row.priority,
    matchType: row.match_type,
    pattern: row.pattern,
    caseSensitive: row.case_sensitive === 1,
    webhookUrl: row.webhook_url,
    payloadFormat: row.payload_format ?? 'comey',
    stopOnMatch: row.stop_on_match === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRoutingRuleRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();
  app.use('*', requireWorkspaceAuth);

  app.get('/', requireScope('webhooks:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const bankAccountId = c.req.query('bankAccountId');

    const query = bankAccountId
      ? c.env.DB.prepare(
          `SELECT * FROM routing_rules WHERE workspace_id = ? AND bank_account_id = ? ORDER BY priority ASC`
        ).bind(workspaceId, bankAccountId)
      : c.env.DB.prepare(
          `SELECT * FROM routing_rules WHERE workspace_id = ? ORDER BY priority ASC`
        ).bind(workspaceId);

    const rows = await query.all<RoutingRuleRow>();
    return c.json({ ok: true, routingRules: rows.results.map(sanitizeRule) });
  });

  app.post('/', requireLiveAuth, requireScope('webhooks:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const body = (await c.req.json().catch(() => null)) as {
      bankAccountId?: string;
      name?: string;
      enabled?: boolean;
      priority?: number;
      matchType?: 'prefix' | 'regex' | 'all';
      pattern?: string;
      caseSensitive?: boolean;
      webhookUrl?: string;
      webhookSecret?: string;
      telegramBotToken?: string;
      telegramChatId?: string;
      payloadFormat?: WebhookPayloadFormat;
      stopOnMatch?: boolean;
    } | null;

    const bankAccountId = String(body?.bankAccountId || '').trim();
    const name = String(body?.name || '').trim() || 'Default Rule';
    const matchType = body?.matchType ?? 'prefix';
    const payloadFormat = body?.payloadFormat ?? 'comey';
    let rawWebhookUrl = String(body?.webhookUrl || '').trim();
    if (payloadFormat === 'telegram' && !rawWebhookUrl && body?.telegramChatId) {
      rawWebhookUrl = `${TELEGRAM_URL_PREFIX}${String(body.telegramChatId).trim()}`;
    }

    if (!bankAccountId) {
      return c.json({ ok: false, error: 'bankAccountId là bắt buộc' }, 400);
    }
    if (!['prefix', 'regex', 'all'].includes(matchType)) {
      return c.json({ ok: false, error: 'matchType không hợp lệ' }, 400);
    }
    if (!WEBHOOK_PAYLOAD_FORMATS.includes(payloadFormat)) {
      return c.json(
        {
          ok: false,
          error:
            'payloadFormat phải là comey, sepay, payos, telegram, discord hoặc google_sheets',
        },
        400
      );
    }
    const cleanPattern = body?.pattern ? String(body.pattern).trim() : '';
    if (matchType !== 'all' && !cleanPattern) {
      return c.json({ ok: false, error: 'Cần nhập mẫu pattern cho prefix/regex' }, 400);
    }
    if (matchType === 'regex') {
      const regexCheck = validateSafeRegexPattern(cleanPattern);
      if (!regexCheck.ok) {
        return c.json({ ok: false, error: regexCheck.reason }, 400);
      }
    }

    const urlCheck = validateSafeOutboundUrl(rawWebhookUrl, {
      allowSandbox: true,
      allowTelegram: payloadFormat === 'telegram',
      allowHttp: payloadFormat !== 'google_sheets',
    });
    if (!urlCheck.ok) {
      return c.json({ ok: false, error: urlCheck.reason }, 400);
    }

    if (
      payloadFormat === 'telegram' &&
      !isSandboxWebhookUrl(urlCheck.url) &&
      !isTelegramTargetUrl(urlCheck.url)
    ) {
      return c.json(
        {
          ok: false,
          error: 'Rule Telegram chỉ hỗ trợ Chat ID (telegram://chat/<id>) hoặc Sandbox Inbox',
        },
        400
      );
    }

    const account = await c.env.DB.prepare(
      `SELECT id FROM bank_accounts WHERE id = ? AND workspace_id = ?`
    )
      .bind(bankAccountId, workspaceId)
      .first<BankAccountRow>();
    if (!account) {
      return c.json({ ok: false, error: 'Không tìm thấy tài khoản ngân hàng' }, 404);
    }

    let plaintextSecret = String(body?.webhookSecret || '').trim();
    if (payloadFormat === 'telegram' && !isSandboxWebhookUrl(urlCheck.url)) {
      const botToken = String(body?.telegramBotToken || plaintextSecret || '').trim();
      if (!TELEGRAM_BOT_TOKEN_REGEX.test(botToken)) {
        return c.json(
          {
            ok: false,
            error: 'Telegram Bot Token không đúng định dạng (VD: 123456789:AAH...)',
          },
          400
        );
      }
      plaintextSecret = botToken;
    } else if (!plaintextSecret) {
      plaintextSecret = `whsec_${randomBase64Url(24)}`;
    }
    const secretEnc = await encryptSecret(plaintextSecret, c.env.MASTER_ENCRYPTION_KEY);

    const id = `rr_${randomHex(10)}`;
    const nowIso = new Date().toISOString();
    const priority = Number.isFinite(body?.priority) ? Math.floor(body!.priority!) : 100;
    const isPassiveNotifier =
      payloadFormat === 'telegram' ||
      payloadFormat === 'discord' ||
      payloadFormat === 'google_sheets';
    const stopOnMatch =
      body?.stopOnMatch !== undefined
        ? body.stopOnMatch
          ? 1
          : 0
        : matchType === 'all' || isPassiveNotifier
          ? 0
          : 1;

    await c.env.DB.prepare(
      `INSERT INTO routing_rules (
        id, workspace_id, bank_account_id, name, enabled, priority,
        match_type, pattern, case_sensitive, webhook_url, webhook_secret_enc,
        payload_format, stop_on_match, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        workspaceId,
        bankAccountId,
        name,
        body?.enabled === false ? 0 : 1,
        priority,
        matchType,
        matchType === 'all' ? null : cleanPattern,
        body?.caseSensitive ? 1 : 0,
        urlCheck.url,
        secretEnc,
        payloadFormat,
        stopOnMatch,
        nowIso,
        nowIso
      )
      .run();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'routing_rule.created',
      resourceType: 'routing_rule',
      resourceId: id,
      ip: getClientIp(c),
      meta: {
        matchType,
        payloadFormat,
        targetHost: isSandboxWebhookUrl(urlCheck.url)
          ? 'sandbox-inbox'
          : isTelegramTargetUrl(urlCheck.url)
            ? 'api.telegram.org'
            : new URL(urlCheck.url).host,
      },
    });

    const created = await c.env.DB.prepare(`SELECT * FROM routing_rules WHERE id = ?`)
      .bind(id)
      .first<RoutingRuleRow>();

    return c.json(
      {
        ok: true,
        routingRule: sanitizeRule(created!),
        webhookSecret:
          payloadFormat === 'telegram' && !isSandboxWebhookUrl(urlCheck.url)
            ? ''
            : plaintextSecret,
      },
      201
    );
  });

  app.patch('/:id', requireLiveAuth, requireScope('webhooks:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT * FROM routing_rules WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<RoutingRuleRow>();
    if (!existing) {
      return c.json({ ok: false, error: 'Routing rule not found' }, 404);
    }

    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      enabled?: boolean;
      priority?: number;
      pattern?: string;
      webhookUrl?: string;
      telegramChatId?: string;
      telegramBotToken?: string;
      payloadFormat?: WebhookPayloadFormat;
      stopOnMatch?: boolean;
    } | null;

    if (body?.payloadFormat !== undefined && !WEBHOOK_PAYLOAD_FORMATS.includes(body.payloadFormat)) {
      return c.json(
        {
          ok: false,
          error:
            'payloadFormat phải là comey, sepay, payos, telegram, discord hoặc google_sheets',
        },
        400
      );
    }

    const effectiveFormat = body?.payloadFormat ?? existing.payload_format ?? 'comey';
    let nextWebhookUrl = existing.webhook_url;
    const rawPatchUrl =
      body?.webhookUrl !== undefined
        ? String(body.webhookUrl).trim()
        : effectiveFormat === 'telegram' && body?.telegramChatId !== undefined
          ? `${TELEGRAM_URL_PREFIX}${String(body.telegramChatId).trim()}`
          : undefined;

    if (rawPatchUrl !== undefined) {
      const urlCheck = validateSafeOutboundUrl(rawPatchUrl, {
        allowSandbox: true,
        allowTelegram: effectiveFormat === 'telegram',
        allowHttp: effectiveFormat !== 'google_sheets',
      });
      if (!urlCheck.ok) {
        return c.json({ ok: false, error: urlCheck.reason }, 400);
      }
      if (
        effectiveFormat === 'telegram' &&
        !isSandboxWebhookUrl(urlCheck.url) &&
        !isTelegramTargetUrl(urlCheck.url)
      ) {
        return c.json(
          { ok: false, error: 'Rule Telegram chỉ hỗ trợ Chat ID hoặc Sandbox Inbox' },
          400
        );
      }
      nextWebhookUrl = urlCheck.url;
    } else if (
      effectiveFormat !== 'telegram' &&
      parseTelegramChatId(nextWebhookUrl) !== null
    ) {
      return c.json(
        { ok: false, error: 'Cần cập nhật webhookUrl HTTP/HTTPS hợp lệ khi đổi định dạng' },
        400
      );
    }

    let nextSecretEnc = existing.webhook_secret_enc;
    if (body?.telegramBotToken && effectiveFormat === 'telegram') {
      const token = String(body.telegramBotToken).trim();
      if (!TELEGRAM_BOT_TOKEN_REGEX.test(token)) {
        return c.json({ ok: false, error: 'Telegram Bot Token không đúng định dạng' }, 400);
      }
      nextSecretEnc = await encryptSecret(token, c.env.MASTER_ENCRYPTION_KEY);
    }

    let nextPattern = existing.pattern;
    if (body?.pattern !== undefined) {
      nextPattern = String(body.pattern).trim();
      if (existing.match_type === 'regex') {
        const regexCheck = validateSafeRegexPattern(nextPattern);
        if (!regexCheck.ok) {
          return c.json({ ok: false, error: regexCheck.reason }, 400);
        }
      }
    }

    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE routing_rules
       SET name = ?, enabled = ?, priority = ?, pattern = ?,
           webhook_url = ?, webhook_secret_enc = ?, payload_format = ?, stop_on_match = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(
        body?.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
        body?.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
        body?.priority !== undefined && Number.isFinite(body.priority)
          ? Math.floor(body.priority)
          : existing.priority,
        nextPattern,
        nextWebhookUrl,
        nextSecretEnc,
        effectiveFormat,
        body?.stopOnMatch !== undefined ? (body.stopOnMatch ? 1 : 0) : existing.stop_on_match,
        nowIso,
        id,
        workspaceId
      )
      .run();

    const updated = await c.env.DB.prepare(`SELECT * FROM routing_rules WHERE id = ?`)
      .bind(id)
      .first<RoutingRuleRow>();

    return c.json({ ok: true, routingRule: sanitizeRule(updated!) });
  });

  app.post('/:id/rotate-secret', requireLiveAuth, requireScope('webhooks:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT id, payload_format, webhook_url FROM routing_rules WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<Pick<RoutingRuleRow, 'id' | 'payload_format' | 'webhook_url'>>();
    if (!existing) {
      return c.json({ ok: false, error: 'Routing rule not found' }, 404);
    }
    if (existing.payload_format === 'telegram' && !isSandboxWebhookUrl(existing.webhook_url)) {
      return c.json(
        {
          ok: false,
          error:
            'Rule Telegram sử dụng Bot Token từ @BotFather; hãy cập nhật telegramBotToken bằng PATCH thay vì xoay secret ngẫu nhiên.',
        },
        400
      );
    }

    const plaintextSecret = `whsec_${randomBase64Url(24)}`;
    const secretEnc = await encryptSecret(plaintextSecret, c.env.MASTER_ENCRYPTION_KEY);
    const nowIso = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE routing_rules SET webhook_secret_enc = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
    )
      .bind(secretEnc, nowIso, id, workspaceId)
      .run();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'routing_rule.secret_rotated',
      resourceType: 'routing_rule',
      resourceId: id,
      ip: getClientIp(c),
    });

    return c.json({ ok: true, webhookSecret: plaintextSecret });
  });

  app.delete('/:id', requireLiveAuth, requireScope('webhooks:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const res = await c.env.DB.prepare(
      `DELETE FROM routing_rules WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .run();
    if ((res.meta?.changes ?? 0) === 0) {
      return c.json({ ok: false, error: 'Routing rule not found' }, 404);
    }

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'routing_rule.deleted',
      resourceType: 'routing_rule',
      resourceId: id,
      ip: getClientIp(c),
    });

    return c.json({ ok: true });
  });

  return app;
}
