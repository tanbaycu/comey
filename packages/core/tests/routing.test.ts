import { describe, expect, it } from 'vitest';
import {
  evaluateRoutingRules,
  extractOrderCodeByPrefix,
  matchesOrderCode,
  type RoutingRule,
} from '../src/index.js';

describe('Multi-App Routing & Order Code Matching', () => {
  it('matches order codes with or without spaces between prefix and digits and enforces strict boundaries on all codes', () => {
    expect(matchesOrderCode('Chuyen khoan MUA 950961 test', 'MUA950961')).toBe(true);
    expect(matchesOrderCode('MUA950961', 'MUA950961')).toBe(true);
    expect(matchesOrderCode('XMUA9509610', 'MUA950961')).toBe(false);
    expect(matchesOrderCode('SHOP123A', 'SHOP123')).toBe(false);
    expect(matchesOrderCode('SHOP 123A', 'SHOP123')).toBe(false);
    expect(matchesOrderCode('INV-100', 'INV-10')).toBe(false);
    expect(matchesOrderCode('XINV-10', 'INV-10')).toBe(false);
    expect(matchesOrderCode('Thanh toan INV-10 ok', 'INV-10')).toBe(true);
    expect(matchesOrderCode('ORD_123', 'ORD_12')).toBe(false);
    expect(matchesOrderCode('ORD_12.', 'ORD_12')).toBe(true);
    expect(extractOrderCodeByPrefix('nap   881122', 'NAP')).toBe('NAP881122');
  });

  it('caps evaluated transfer content to 512 chars in evaluateRoutingRules', () => {
    const rules: RoutingRule[] = [
      {
        id: 'r_regex',
        name: 'Invoice Regex',
        enabled: true,
        priority: 10,
        matchType: 'regex',
        pattern: 'INV-(\\d{5})',
        webhookUrl: 'https://erp.example.com/wh',
      },
    ];
    const beyondCap = `${'x'.repeat(600)} INV-54321`;
    expect(evaluateRoutingRules(beyondCap, rules)).toHaveLength(0);

    const withinCap = `${'x'.repeat(100)} INV-54321`;
    expect(evaluateRoutingRules(withinCap, rules)).toHaveLength(1);
  });

  it('routes 1 bank account across multiple apps by priority and ignores personal transfers', () => {
    const rules: RoutingRule[] = [
      {
        id: 'r_bot',
        name: 'Telegram Bot',
        enabled: true,
        priority: 20,
        matchType: 'prefix',
        pattern: 'BOT',
        webhookUrl: 'https://bot.example.com/wh',
      },
      {
        id: 'r_shop',
        name: 'Web Shop',
        enabled: true,
        priority: 10,
        matchType: 'prefix',
        pattern: 'SHOP',
        webhookUrl: 'https://shop.example.com/wh',
      },
      {
        id: 'r_regex',
        name: 'Invoice Regex',
        enabled: true,
        priority: 30,
        matchType: 'regex',
        pattern: 'INV-(\\d{5})',
        webhookUrl: 'https://erp.example.com/wh',
      },
      {
        id: 'r_bad_regex',
        name: 'Broken Rule',
        enabled: true,
        priority: 5,
        matchType: 'regex',
        pattern: '([unclosed',
        webhookUrl: 'https://bad.example.com/wh',
      },
    ];

    const shopMatch = evaluateRoutingRules('Thanh toan SHOP 102938', rules);
    expect(shopMatch).toHaveLength(1);
    expect(shopMatch[0]?.rule.id).toBe('r_shop');
    expect(shopMatch[0]?.extractedCode).toBe('SHOP102938');

    const erpMatch = evaluateRoutingRules('Thanh toan inv-54321', rules);
    expect(erpMatch).toHaveLength(1);
    expect(erpMatch[0]?.rule.id).toBe('r_regex');
    expect(erpMatch[0]?.extractedCode).toBe('54321');

    const personal = evaluateRoutingRules('Tra tien ca phe sang', rules);
    expect(personal).toHaveLength(0);
  });
});
