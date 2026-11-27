import type { RouteMatchResult, RoutingRule } from '../types.js';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MAX_ROUTING_CONTENT_LEN = 512;

export function matchesOrderCode(rawContent: string, orderCode: string): boolean {
  const cleanCode = String(orderCode || '').trim().toUpperCase();
  if (!cleanCode) return false;
  const content = String(rawContent || '');

  const m = cleanCode.match(/^([A-Z]+)(\d+)$/);
  if (m) {
    const regex = new RegExp(
      `(?<![A-Z0-9])${escapeRegExp(m[1]!)}\\s*${escapeRegExp(m[2]!)}(?![A-Z0-9])`,
      'i'
    );
    return regex.test(content);
  }
  const regex = new RegExp(`(?<![A-Z0-9])${escapeRegExp(cleanCode)}(?![A-Z0-9])`, 'i');
  return regex.test(content);
}

export function extractOrderCodeByPrefix(
  rawContent: string,
  prefix: string,
  options?: { minDigits?: number; maxDigits?: number; caseSensitive?: boolean }
): string | null {
  const cleanPrefix = String(prefix || '').trim();
  if (!cleanPrefix) return null;

  const minDigits = options?.minDigits ?? 3;
  const maxDigits = options?.maxDigits ?? 12;
  const flags = options?.caseSensitive ? '' : 'i';
  const regex = new RegExp(
    `(?<![A-Z0-9])(${escapeRegExp(cleanPrefix)})\\s*(\\d{${minDigits},${maxDigits}})(?!\\d)`,
    flags
  );
  const match = String(rawContent || '').match(regex);
  if (!match) return null;

  const matchedPrefix = options?.caseSensitive ? match[1]! : match[1]!.toUpperCase();
  return `${matchedPrefix}${match[2]!}`;
}

export function evaluateRoutingRules(content: string, rules: RoutingRule[]): RouteMatchResult[] {
  const sorted = rules
    .filter((r) => r.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  const matches: RouteMatchResult[] = [];
  const rawContent = String(content || '').slice(0, MAX_ROUTING_CONTENT_LEN);

  for (const rule of sorted) {
    if (rule.matchType === 'all') {
      matches.push({ rule });
      if (rule.stopOnMatch === true) break;
      continue;
    }

    if (rule.matchType === 'prefix') {
      if (!rule.pattern) continue;
      const extracted = extractOrderCodeByPrefix(rawContent, rule.pattern, {
        caseSensitive: rule.caseSensitive,
      });
      if (extracted) {
        matches.push({ rule, extractedCode: extracted });
        if (rule.stopOnMatch !== false) break;
      }
      continue;
    }

    if (rule.matchType === 'regex') {
      if (!rule.pattern) continue;
      try {
        const flags = rule.caseSensitive ? '' : 'i';
        const regex = new RegExp(rule.pattern, flags);
        const m = rawContent.match(regex);
        if (m) {
          const extracted = (m[1] || m[0] || '').trim().toUpperCase() || undefined;
          matches.push({ rule, extractedCode: extracted });
          if (rule.stopOnMatch !== false) break;
        }
      } catch {
        // Ignore malformed user regex so one bad rule never breaks dispatching
      }
    }
  }

  return matches;
}
