import { describe, expect, it } from 'vitest';
import {
  API_KEY_PRESETS,
  API_KEY_SCOPES,
  hasApiScope,
  isIpAllowed,
  normalizeApiScopes,
  parseAllowedIps,
} from '../src/index.js';

describe('API Scopes & IP Allowlist Utilities', () => {
  it('validates, deduplicates, and collapses wildcard scopes cleanly', () => {
    expect(API_KEY_SCOPES).toContain('transactions:read');
    expect(API_KEY_PRESETS.merchant_bot).toEqual([
      'sessions:read',
      'sessions:write',
      'transactions:read',
    ]);

    expect(
      normalizeApiScopes(['transactions:read', 'sessions:read', 'transactions:read'])
    ).toEqual(['transactions:read', 'sessions:read']);

    expect(normalizeApiScopes(['transactions:read', '*'])).toEqual(['*']);
    expect(normalizeApiScopes([])).toEqual([]);
    expect(normalizeApiScopes('not-an-array')).toEqual([]);
    expect(normalizeApiScopes(['transactions:read', 'bogus:admin'])).toEqual([]);

    expect(hasApiScope(['transactions:read'], 'transactions:read')).toBe(true);
    expect(hasApiScope(['transactions:read'], 'sessions:write')).toBe(false);
    expect(hasApiScope(['*'], 'accounts:write')).toBe(true);
  });

  it('parses IPv4, IPv4 CIDR, and IPv6 allowlists while rejecting malformed entries', () => {
    const parsed = parseAllowedIps('203.0.113.10, 198.51.100.0/24\n2001:0db8::1; 203.0.113.10');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.ips).toEqual(['203.0.113.10', '198.51.100.0/24', '2001:db8::1']);
    }

    expect(parseAllowedIps(null)).toEqual({ ok: true, ips: [] });
    expect(parseAllowedIps('')).toEqual({ ok: true, ips: [] });
    expect(parseAllowedIps('999.1.2.3').ok).toBe(false);
    expect(parseAllowedIps('10.0.0.0/33').ok).toBe(false);
    expect(parseAllowedIps('not-an-ip').ok).toBe(false);
  });

  it('matches exact IPv4, IPv4 CIDR, IPv4-mapped IPv6, and canonical IPv6 addresses', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);

    const rules = ['203.0.113.10', '198.51.100.0/24', '2001:db8::1'];
    expect(isIpAllowed('203.0.113.10', rules)).toBe(true);
    expect(isIpAllowed('::ffff:203.0.113.10', rules)).toBe(true);
    expect(isIpAllowed('198.51.100.42', rules)).toBe(true);
    expect(isIpAllowed('198.51.101.42', rules)).toBe(false);
    expect(isIpAllowed('2001:0db8:0000:0000:0000:0000:0000:0001', rules)).toBe(true);
    expect(isIpAllowed('2001:db8::2', rules)).toBe(false);
    expect(isIpAllowed('', rules)).toBe(false);

    // Explicitly check /0 boundary does not wrap bit-shift in JS
    expect(isIpAllowed('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
  });
});
