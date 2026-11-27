import {
  hashPassword,
  randomBase64Url,
  randomHex,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from '@comey/core';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { UserRow, WorkspaceRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import {
  clearSessionCookie,
  requireSessionAuth,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  setSessionCookie,
} from '../middleware/auth.js';
import { checkRateLimit, getClientIp } from '../middleware/rateLimit.js';
import { validatePasswordStrength } from '../security/urlGuard.js';
import { recordAuditLog } from '../services/audit.js';

// Constant PBKDF2 hash used to equalize response latency when email is not found
const DUMMY_PBKDF2_HASH =
  'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function createAuthRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();

  app.post('/register', async (c) => {
    const ip = getClientIp(c);
    const rl = await checkRateLimit(c.env.DB, `auth_reg:${ip}`, 10, 3600);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      return c.json(
        {
          ok: false,
          error: `Quá nhiều yêu cầu đăng ký. Thử lại sau ${rl.retryAfterSeconds}s.`,
        },
        429
      );
    }

    const body = (await c.req.json().catch(() => null)) as {
      email?: string;
      password?: string;
      name?: string;
      workspaceName?: string;
      bootstrapKey?: string;
    } | null;

    // MED-1: Fail-closed ALLOW_PUBLIC_SIGNUP check
    const allowSignup = (c.env.ALLOW_PUBLIC_SIGNUP || '').trim().toLowerCase() === 'true';
    if (!allowSignup) {
      const bootstrapExpected = String(c.env.ADMIN_BOOTSTRAP_KEY || '').trim();
      const provided = String(body?.bootstrapKey || '').trim();
      if (!bootstrapExpected || !provided) {
        return c.json({ ok: false, error: 'Public registration is disabled' }, 403);
      }
      const [providedHash, expectedHash] = await Promise.all([
        sha256Hex(provided),
        sha256Hex(bootstrapExpected),
      ]);
      if (!timingSafeEqual(providedHash, expectedHash)) {
        return c.json({ ok: false, error: 'Public registration is disabled' }, 403);
      }
      const userCount = await c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM users`).first<{
        cnt: number;
      }>();
      if (Number(userCount?.cnt ?? 0) > 0) {
        return c.json(
          { ok: false, error: 'Bootstrap key is only valid for initial 0-user setup' },
          403
        );
      }
    }

    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const name = String(body?.name || '').trim() || email.split('@')[0] || 'Owner';
    const workspaceName = String(body?.workspaceName || '').trim() || `${name}'s Workspace`;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ ok: false, error: 'Email không đúng định dạng' }, 400);
    }
    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.ok) {
      return c.json({ ok: false, error: pwCheck.reason }, 400);
    }

    const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
      .bind(email)
      .first<{ id: string }>();
    if (existing) {
      return c.json({ ok: false, error: 'Email đã được đăng ký' }, 409);
    }

    const nowIso = new Date().toISOString();
    const userId = `usr_${randomHex(12)}`;
    const workspaceId = `ws_${randomHex(12)}`;
    const passwordHash = await hashPassword(password);

    const sessionToken = randomBase64Url(32);
    const tokenHash = await sha256Hex(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'owner', ?, ?)`
      ).bind(userId, email, name, passwordHash, nowIso, nowIso),
      c.env.DB.prepare(
        `INSERT INTO workspaces (id, owner_user_id, name, created_at)
         VALUES (?, ?, ?, ?)`
      ).bind(workspaceId, userId, workspaceName, nowIso),
      c.env.DB.prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, workspace_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(tokenHash, userId, workspaceId, expiresAt, nowIso),
    ]);

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: userId,
      action: 'auth.register',
      resourceType: 'workspace',
      resourceId: workspaceId,
      ip,
    });

    setSessionCookie(c, sessionToken);
    return c.json(
      {
        ok: true,
        user: { id: userId, email, name, role: 'owner' },
        workspace: { id: workspaceId, name: workspaceName },
      },
      201
    );
  });

  app.post('/login', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      email?: string;
      password?: string;
    } | null;

    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!email || !password) {
      return c.json({ ok: false, error: 'Email và mật khẩu là bắt buộc' }, 400);
    }

    const ip = getClientIp(c);
    // MED-2: Enforce both per-IP+account AND per-account login throttling
    const [ipRl, acctRl] = await Promise.all([
      checkRateLimit(c.env.DB, `auth_login:${ip}:${email}`, 10, 900),
      checkRateLimit(c.env.DB, `auth_login_acct:${email}`, 25, 900),
    ]);
    if (!ipRl.allowed || !acctRl.allowed) {
      const retryAfter = !ipRl.allowed ? ipRl.retryAfterSeconds : acctRl.retryAfterSeconds;
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          ok: false,
          error: `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${retryAfter}s.`,
        },
        429
      );
    }

    const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
      .bind(email)
      .first<UserRow>();
    if (!user) {
      await verifyPassword(password, DUMMY_PBKDF2_HASH).catch(() => false);
      return c.json({ ok: false, error: 'Sai email hoặc mật khẩu' }, 401);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return c.json({ ok: false, error: 'Sai email hoặc mật khẩu' }, 401);
    }

    const workspace = await c.env.DB.prepare(
      `SELECT * FROM workspaces WHERE owner_user_id = ? ORDER BY created_at ASC LIMIT 1`
    )
      .bind(user.id)
      .first<WorkspaceRow>();
    if (!workspace) {
      return c.json({ ok: false, error: 'Workspace not found for user' }, 500);
    }

    const sessionToken = randomBase64Url(32);
    const tokenHash = await sha256Hex(sessionToken);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

    await c.env.DB.prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, workspace_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(tokenHash, user.id, workspace.id, expiresAt, nowIso)
      .run();

    await recordAuditLog(c.env, {
      workspaceId: workspace.id,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'session',
      ip,
    });

    setSessionCookie(c, sessionToken);
    return c.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      workspace: { id: workspace.id, name: workspace.name },
    });
  });

  app.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (token) {
      const tokenHash = await sha256Hex(token);
      const existing = await c.env.DB.prepare(
        `SELECT user_id, workspace_id FROM auth_sessions WHERE token_hash = ?`
      )
        .bind(tokenHash)
        .first<{ user_id: string; workspace_id: string }>()
        .catch(() => null);

      await c.env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`)
        .bind(tokenHash)
        .run()
        .catch(() => {});

      if (existing) {
        await recordAuditLog(c.env, {
          workspaceId: existing.workspace_id,
          actorType: 'user',
          actorId: existing.user_id,
          action: 'auth.logout',
          resourceType: 'session',
          ip: getClientIp(c),
        });
      }
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post('/logout-all', requireSessionAuth, async (c) => {
    const userId = c.get('userId')!;
    const workspaceId = c.get('workspaceId');

    await c.env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(userId).run();
    await recordAuditLog(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: userId,
      action: 'auth.logout_all',
      resourceType: 'user',
      resourceId: userId,
      ip: getClientIp(c),
    });

    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post('/change-password', requireSessionAuth, async (c) => {
    const userId = c.get('userId')!;
    const workspaceId = c.get('workspaceId');
    const ip = getClientIp(c);

    // MED-2: Rate-limit password change attempts
    const rl = await checkRateLimit(c.env.DB, `auth_chpw:${userId}:${ip}`, 5, 900);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      return c.json(
        {
          ok: false,
          error: `Quá nhiều lần đổi mật khẩu. Vui lòng thử lại sau ${rl.retryAfterSeconds}s.`,
        },
        429
      );
    }

    const body = (await c.req.json().catch(() => null)) as {
      currentPassword?: string;
      newPassword?: string;
    } | null;

    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');
    if (!currentPassword) {
      return c.json({ ok: false, error: 'Cần nhập mật khẩu hiện tại' }, 400);
    }

    const pwCheck = validatePasswordStrength(newPassword);
    if (!pwCheck.ok) {
      return c.json({ ok: false, error: pwCheck.reason }, 400);
    }

    const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
      .bind(userId)
      .first<UserRow>();
    // UI-H1: Return HTTP 400 (not 401) on wrong current password so Dashboard doesn't trigger logout
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      return c.json({ ok: false, error: 'Mật khẩu hiện tại không đúng' }, 400);
    }

    const newHash = await hashPassword(newPassword);
    const nowIso = new Date().toISOString();
    const newSessionToken = randomBase64Url(32);
    const newTokenHash = await sha256Hex(newSessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(
        newHash,
        nowIso,
        userId
      ),
      c.env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(userId),
      c.env.DB.prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, workspace_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(newTokenHash, userId, workspaceId, expiresAt, nowIso),
    ]);

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: userId,
      action: 'auth.password_changed',
      resourceType: 'user',
      resourceId: userId,
      ip,
    });

    setSessionCookie(c, newSessionToken);
    return c.json({ ok: true });
  });

  app.get('/me', requireSessionAuth, async (c) => {
    const userId = c.get('userId')!;
    const workspaceId = c.get('workspaceId');

    const user = await c.env.DB.prepare(
      `SELECT id, email, name, role, created_at FROM users WHERE id = ?`
    )
      .bind(userId)
      .first();
    const workspace = await c.env.DB.prepare(
      `SELECT id, name, created_at FROM workspaces WHERE id = ?`
    )
      .bind(workspaceId)
      .first();

    return c.json({ ok: true, user, workspace });
  });

  return app;
}
