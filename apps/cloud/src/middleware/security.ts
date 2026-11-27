import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppContextEnv } from '../env.js';
import { SESSION_COOKIE_NAME } from './auth.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function securityHeadersMiddleware(
  c: Context<AppContextEnv>,
  next: Next
): Promise<void> {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const path = c.req.path;
  if (path.startsWith('/v1/') || path.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store');
  }

  if (new URL(c.req.url).protocol === 'https:') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export async function csrfOriginGuardMiddleware(
  c: Context<AppContextEnv>,
  next: Next
): Promise<Response | void> {
  if (!MUTATING_METHODS.has(c.req.method.toUpperCase())) {
    await next();
    return;
  }

  // Enforce strict fail-closed CSRF checks on any mutating request carrying a session cookie.
  // Never bypass CSRF checks based on unvalidated headers (SEC-H2).
  const hasSessionCookie = Boolean(getCookie(c, SESSION_COOKIE_NAME));
  if (!hasSessionCookie) {
    await next();
    return;
  }

  const fetchSite = (c.req.header('sec-fetch-site') || '').trim().toLowerCase();
  if (fetchSite === 'cross-site') {
    return c.json({ ok: false, error: 'Cross-site request blocked (CSRF guard)' }, 403);
  }

  const reqOrigin = new URL(c.req.url).origin;
  let publicOrigin = reqOrigin;
  try {
    if (c.env.PUBLIC_BASE_URL) {
      publicOrigin = new URL(c.env.PUBLIC_BASE_URL).origin;
    }
  } catch {
    publicOrigin = reqOrigin;
  }

  const origin = (c.req.header('origin') || '').trim();
  if (origin) {
    if (origin !== reqOrigin && origin !== publicOrigin) {
      return c.json({ ok: false, error: 'Origin mismatch blocked (CSRF guard)' }, 403);
    }
  } else if (fetchSite !== 'same-origin') {
    return c.json(
      { ok: false, error: 'Missing Origin or same-origin Sec-Fetch-Site header (CSRF guard)' },
      403
    );
  }

  // Require application/json Content-Type whenever a non-empty request body is sent
  const contentLengthHeader = c.req.header('content-length');
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN;
  const hasTransferEncoding = Boolean(c.req.header('transfer-encoding'));
  const hasBody =
    (Number.isFinite(contentLength) && contentLength > 0) ||
    hasTransferEncoding ||
    (c.req.raw.body !== null && contentLengthHeader !== '0');

  if (hasBody) {
    const contentType = (c.req.header('content-type') || '').trim().toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return c.json(
        { ok: false, error: 'Content-Type must be application/json (CSRF guard)' },
        415
      );
    }
  }

  await next();
}
