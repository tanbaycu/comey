export const API_KEY_SCOPES = [
  '*',
  'transactions:read',
  'sessions:read',
  'sessions:write',
  'accounts:read',
  'accounts:write',
  'webhooks:read',
  'webhooks:write',
  'soundboxes:read',
  'soundboxes:write',
  'simulator:write',
  'quarantine:read',
  'quarantine:write',
  'security:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES);

export type ApiKeyPresetId = 'merchant_bot' | 'readonly' | 'sandbox' | 'full_admin';

export const API_KEY_PRESETS: Record<ApiKeyPresetId, readonly ApiKeyScope[]> = {
  merchant_bot: ['sessions:read', 'sessions:write', 'transactions:read'],
  readonly: ['transactions:read', 'sessions:read', 'accounts:read'],
  sandbox: ['sessions:read', 'sessions:write', 'transactions:read', 'simulator:write'],
  full_admin: ['*'],
};

/**
 * Validate and normalize an API key scope list.
 * Returns an empty array if input is empty or contains any unrecognized scope
 * so callers can fail closed with HTTP 400.
 */
export function normalizeApiScopes(raw: unknown): ApiKeyScope[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const seen = new Set<ApiKeyScope>();
  const out: ApiKeyScope[] = [];

  for (const item of raw) {
    if (typeof item !== 'string') {
      return [];
    }
    const trimmed = item.trim();
    if (!API_KEY_SCOPE_SET.has(trimmed)) {
      return [];
    }
    const typed = trimmed as ApiKeyScope;
    if (typed === '*') {
      return ['*'];
    }
    if (!seen.has(typed)) {
      seen.add(typed);
      out.push(typed);
    }
  }

  return out;
}

/**
 * Check whether an API key's granted scopes satisfy a required route scope.
 */
export function hasApiScope(
  granted: readonly string[],
  required: ApiKeyScope
): boolean {
  return granted.includes('*') || granted.includes(required);
}

function parseIpv4Int(raw: string): number | null {
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return null;
    }
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    value = ((value << 8) | num) >>> 0;
  }
  return value;
}

function normalizeIpv6Literal(raw: string): string | null {
  if (!raw || raw.includes('[') || raw.includes(']') || !raw.includes(':')) {
    return null;
  }
  try {
    const parsed = new URL(`http://[${raw}]/`);
    const host = parsed.hostname;
    if (!host.startsWith('[') || !host.endsWith(']')) {
      return null;
    }
    return host.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export type ParseAllowedIpsResult =
  | { ok: true; ips: string[] }
  | { ok: false; reason: string };

/**
 * Parse and validate a comma/newline-separated IP allowlist supporting
 * IPv4 literals, IPv4 CIDR (/0../32), and IPv6 literals.
 */
export function parseAllowedIps(
  raw: string | string[] | null | undefined
): ParseAllowedIpsResult {
  if (raw === null || raw === undefined) {
    return { ok: true, ips: [] };
  }

  const tokens = Array.isArray(raw)
    ? raw.map((item) => String(item ?? '').trim()).filter(Boolean)
    : String(raw)
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);

  if (tokens.length === 0) {
    return { ok: true, ips: [] };
  }
  if (tokens.length > 64) {
    return { ok: false, reason: 'IP allowlist supports at most 64 entries' };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of tokens) {
    if (entry.includes('/')) {
      const slashParts = entry.split('/');
      if (slashParts.length !== 2) {
        return { ok: false, reason: `Invalid CIDR entry: ${entry}` };
      }
      const ipPart = slashParts[0] ?? '';
      const prefixPart = slashParts[1] ?? '';
      const ipv4 = parseIpv4Int(ipPart);
      if (ipv4 === null || !/^(0|[1-9]\d?)$/.test(prefixPart)) {
        return { ok: false, reason: `Invalid IPv4 CIDR entry: ${entry}` };
      }
      const prefix = Number(prefixPart);
      if (prefix < 0 || prefix > 32) {
        return { ok: false, reason: `Invalid IPv4 CIDR prefix length: ${entry}` };
      }
      const canonical = `${ipPart}/${prefix}`;
      if (!seen.has(canonical)) {
        seen.add(canonical);
        normalized.push(canonical);
      }
      continue;
    }

    const ipv4 = parseIpv4Int(entry);
    if (ipv4 !== null) {
      if (!seen.has(entry)) {
        seen.add(entry);
        normalized.push(entry);
      }
      continue;
    }

    const ipv6 = normalizeIpv6Literal(entry);
    if (ipv6 !== null) {
      if (!seen.has(ipv6)) {
        seen.add(ipv6);
        normalized.push(ipv6);
      }
      continue;
    }

    return { ok: false, reason: `Invalid IP address or CIDR entry: ${entry}` };
  }

  return { ok: true, ips: normalized };
}

function extractClientIpv4(clientIp: string): number | null {
  const direct = parseIpv4Int(clientIp);
  if (direct !== null) return direct;

  const ipv6 = normalizeIpv6Literal(clientIp);
  if (!ipv6) return null;

  // WHATWG canonicalizes ::ffff:a.b.c.d -> ::ffff:xxxx:yyyy
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ipv6);
  if (mappedHex?.[1] && mappedHex?.[2]) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    return ((hi << 16) | lo) >>> 0;
  }

  return null;
}

/**
 * Evaluate whether clientIp satisfies allowedIps (empty allowlist permits all IPs).
 */
export function isIpAllowed(
  clientIp: string,
  allowedIps: readonly string[]
): boolean {
  if (allowedIps.length === 0) {
    return true;
  }

  const trimmed = clientIp.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) {
    return false;
  }

  const clientV4 = extractClientIpv4(trimmed);
  const clientV6 = normalizeIpv6Literal(trimmed);

  for (const rule of allowedIps) {
    if (rule.includes('/')) {
      if (clientV4 === null) continue;
      const slashIdx = rule.indexOf('/');
      const baseIp = rule.slice(0, slashIdx);
      const prefix = Number(rule.slice(slashIdx + 1));
      const baseV4 = parseIpv4Int(baseIp);
      if (baseV4 === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        continue;
      }
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      if ((clientV4 & mask) === (baseV4 & mask)) {
        return true;
      }
      continue;
    }

    const ruleV4 = parseIpv4Int(rule);
    if (ruleV4 !== null) {
      if (clientV4 !== null && clientV4 === ruleV4) {
        return true;
      }
      continue;
    }

    const ruleV6 = normalizeIpv6Literal(rule);
    if (ruleV6 !== null && clientV6 !== null && clientV6 === ruleV6) {
      return true;
    }
  }

  return false;
}
