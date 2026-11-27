export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

function isPrivateOrReservedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;

  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / AWS/Cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // RFC 2544 benchmarking / interconnect
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function parseIpv6Hextets(raw: string): number[] | null {
  if (!raw || raw.includes('%')) return null;

  let addr = raw.toLowerCase();
  let embeddedIpv4Hextets: number[] | null = null;

  const lastColon = addr.lastIndexOf(':');
  const tail = lastColon >= 0 ? addr.slice(lastColon + 1) : '';
  if (tail.includes('.')) {
    const m = tail.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    embeddedIpv4Hextets = [
      ((octets[0]! << 8) | octets[1]!) >>> 0,
      ((octets[2]! << 8) | octets[3]!) >>> 0,
    ];
    addr = addr.slice(0, lastColon);
    if (addr.endsWith(':')) {
      // Preserve `::` when input was like `::127.0.0.1` -> addr became `:` -> restore `::`
      addr = `${addr}:`;
    }
  }

  const targetHextets = embeddedIpv4Hextets ? 6 : 8;
  const doubleColonParts = addr.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegmentList = (seg: string): number[] | null => {
    if (!seg) return [];
    const items = seg.split(':');
    const out: number[] = [];
    for (const item of items) {
      if (!/^[0-9a-f]{1,4}$/i.test(item)) return null;
      out.push(Number.parseInt(item, 16));
    }
    return out;
  };

  let hextets: number[];
  if (doubleColonParts.length === 2) {
    const left = parseSegmentList(doubleColonParts[0]!);
    const right = parseSegmentList(doubleColonParts[1]!);
    if (!left || !right) return null;
    const missing = targetHextets - (left.length + right.length);
    if (missing < 1) return null;
    hextets = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const parsed = parseSegmentList(doubleColonParts[0]!);
    if (!parsed || parsed.length !== targetHextets) return null;
    hextets = parsed;
  }

  if (embeddedIpv4Hextets) {
    hextets.push(embeddedIpv4Hextets[0]!, embeddedIpv4Hextets[1]!);
  }

  return hextets.length === 8 ? hextets : null;
}

function isPrivateOrReservedIpv6(host: string, allowLocalhost: boolean): boolean {
  const h = parseIpv6Hextets(host);
  if (!h) return true; // Fail closed on unparseable IPv6 literal

  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // ::/128 unspecified
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && h7 === 0) {
    return true;
  }
  // ::1/128 loopback
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && h7 === 1) {
    return !allowLocalhost;
  }
  // ::ffff:0:0/96 IPv4-mapped IPv6
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return true;
  }
  // ::ffff:0:0:0/96 IPv4-translated (RFC 2765)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0xffff && h5 === 0) {
    return true;
  }
  // ::/96 deprecated IPv4-compatible IPv6
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return true;
  }
  // 64:ff9b::/96 (NAT64 well-known prefix) & 64:ff9b:1::/48 (local NAT64)
  if (
    h0 === 0x0064 &&
    h1 === 0xff9b &&
    ((h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) || h2 === 0x0001)
  ) {
    return true;
  }
  // fc00::/7 Unique Local Address (ULA)
  if ((h0 & 0xfe00) === 0xfc00) {
    return true;
  }
  // fe80::/10 link-local
  if ((h0 & 0xffc0) === 0xfe80) {
    return true;
  }
  // fec0::/10 deprecated site-local
  if ((h0 & 0xffc0) === 0xfec0) {
    return true;
  }
  // ff00::/8 multicast
  if ((h0 & 0xff00) === 0xff00) {
    return true;
  }
  // 100::/64 discard-only prefix (RFC 6666)
  if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) {
    return true;
  }
  // 2002::/16 6to4 (embeds arbitrary IPv4 addresses, e.g. 2002:7f00:1:: -> 127.0.0.1)
  if (h0 === 0x2002) {
    return true;
  }
  // 2001::/32 Teredo tunneling (RFC 4380)
  if (h0 === 0x2001 && h1 === 0x0000) {
    return true;
  }
  // 2001:db8::/32 documentation prefix (RFC 3849) & 2001:2::/48 benchmarking
  if (h0 === 0x2001 && (h1 === 0x0db8 || (h1 === 0x0002 && h2 === 0x0000))) {
    return true;
  }

  return false;
}

function isPrivateOrReservedHost(hostname: string, allowLocalhost = false): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  if (!host) return true;

  if (!allowLocalhost) {
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal'
    ) {
      return true;
    }
  }

  // Block pure decimal/hex/octal numeric IP encodings (e.g. 2130706433, 0x7f000001)
  if (/^(?:\d+|0x[0-9a-f]+|0[0-7]+)$/i.test(host)) {
    return true;
  }

  if (isPrivateOrReservedIpv4(host)) {
    return !allowLocalhost || host !== '127.0.0.1';
  }

  if (host.includes(':')) {
    return isPrivateOrReservedIpv6(host, allowLocalhost);
  }

  return false;
}

export const SANDBOX_WEBHOOK_URL = 'internal://sandbox-inbox';
export const TELEGRAM_URL_PREFIX = 'telegram://chat/';

export function isSandboxWebhookUrl(raw: string): boolean {
  return String(raw || '').trim() === SANDBOX_WEBHOOK_URL;
}

export function parseTelegramChatId(raw: string): string | null {
  const match = /^telegram:\/\/chat\/(-?\d{4,20})$/.exec(String(raw || '').trim());
  return match?.[1] ?? null;
}

export function isTelegramTargetUrl(raw: string): boolean {
  return parseTelegramChatId(raw) !== null;
}

export function validateSafeOutboundUrl(
  raw: string,
  options?: {
    allowHttp?: boolean;
    allowLocalhost?: boolean;
    allowSandbox?: boolean;
    allowTelegram?: boolean;
  }
): UrlValidationResult {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, reason: 'URL không được để trống' };
  }
  if (trimmed === SANDBOX_WEBHOOK_URL) {
    if (options?.allowSandbox === true) {
      return { ok: true, url: SANDBOX_WEBHOOK_URL };
    }
    return { ok: false, reason: 'URL sandbox nội bộ không được phép tại đây' };
  }
  const telegramChatId = parseTelegramChatId(trimmed);
  if (telegramChatId !== null) {
    if (options?.allowTelegram === true) {
      return { ok: true, url: `${TELEGRAM_URL_PREFIX}${telegramChatId}` };
    }
    return {
      ok: false,
      reason: 'Đích telegram://chat/... chỉ hợp lệ cho luật định dạng Telegram',
    };
  }
  if (trimmed.length > 512) {
    return { ok: false, reason: 'URL vượt quá giới hạn 512 ký tự' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'URL không đúng định dạng' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Không cho phép nhúng thông tin đăng nhập trong URL' };
  }

  const allowHttp = options?.allowHttp ?? true;
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    return { ok: false, reason: 'Chỉ hỗ trợ giao thức HTTPS hoặc HTTP hợp lệ' };
  }

  if (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443') {
    return {
      ok: false,
      reason: 'Chỉ cho phép cổng HTTP/HTTPS tiêu chuẩn (80 hoặc 443)',
    };
  }

  if (isPrivateOrReservedHost(parsed.hostname, options?.allowLocalhost ?? false)) {
    return {
      ok: false,
      reason: 'URL trỏ vào địa chỉ nội bộ hoặc loopback đã bị chặn (chống SSRF)',
    };
  }

  return { ok: true, url: parsed.toString() };
}

export function validateAppsScriptUrl(raw: string): UrlValidationResult {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, reason: 'Apps Script URL không được để trống' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Apps Script URL không hợp lệ' };
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'script.google.com' ||
    parsed.port !== '' ||
    !parsed.pathname.startsWith('/macros/s/') ||
    parsed.username ||
    parsed.password
  ) {
    return {
      ok: false,
      reason: 'Apps Script URL phải bắt đầu bằng https://script.google.com/macros/s/...',
    };
  }
  return { ok: true, url: parsed.toString() };
}

interface ParsedQuantifier {
  endIndex: number;
  isRepeating: boolean;
  isUnbounded: boolean;
  isVariableLength: boolean;
  excessive: boolean;
}

function readQuantifierAt(p: string, start: number): ParsedQuantifier | null {
  if (start >= p.length) return null;
  const ch = p[start];
  if (ch === '*' || ch === '+') {
    const end = p[start + 1] === '?' ? start + 2 : start + 1;
    return {
      endIndex: end,
      isRepeating: true,
      isUnbounded: true,
      isVariableLength: true,
      excessive: false,
    };
  }
  if (ch === '?') {
    const end = p[start + 1] === '?' ? start + 2 : start + 1;
    return {
      endIndex: end,
      isRepeating: false,
      isUnbounded: false,
      isVariableLength: true,
      excessive: false,
    };
  }
  if (ch === '{') {
    const rest = p.slice(start);
    const m = rest.match(/^\{(\d+)(?:,(\d*))?\}(\??)/);
    if (!m) return null;
    const min = Number.parseInt(m[1]!, 10);
    const hasComma = m[0].includes(',');
    const maxStr = m[2];
    const isUnbounded = hasComma && !maxStr;
    const max = maxStr ? Number.parseInt(maxStr, 10) : min;
    const excessive =
      min > 50 ||
      (!isUnbounded && max > 50) ||
      (!isUnbounded && max < min);
    const isRepeating = isUnbounded || max > 1 || min > 1;
    const isVariableLength = isUnbounded || (hasComma && max !== min);
    return {
      endIndex: start + m[0].length,
      isRepeating,
      isUnbounded,
      isVariableLength,
      excessive,
    };
  }
  return null;
}

export function validateSafeRegexPattern(
  pattern: string
): { ok: true } | { ok: false; reason: string } {
  const p = String(pattern || '').trim();
  if (!p) {
    return { ok: false, reason: 'Mẫu regex không được để trống' };
  }
  if (p.length > 120) {
    return { ok: false, reason: 'Mẫu regex tối đa 120 ký tự' };
  }

  const redosReason =
    'Mẫu regex chứa cấu trúc có nguy cơ ReDoS, vui lòng viết đơn giản hơn';

  interface GroupFrame {
    hasAnyQuantifier: boolean;
    hasAlternation: boolean;
    prevAtomRepeating: boolean;
  }

  const stack: GroupFrame[] = [
    { hasAnyQuantifier: false, hasAlternation: false, prevAtomRepeating: false },
  ];

  let totalQuantifiers = 0;
  let totalUnboundedQuantifiers = 0;
  let totalVariableQuantifiers = 0;
  let i = 0;

  const applyAtomQuantifier = (frame: GroupFrame, q: ParsedQuantifier | null): boolean => {
    if (!q) {
      frame.prevAtomRepeating = false;
      return true;
    }
    if (q.excessive) return false;

    totalQuantifiers++;
    // Track ALL quantifiers including `?` and `{0,1}` so `(a?a)+` / `((a?)a)+` are rejected
    frame.hasAnyQuantifier = true;

    if (q.isVariableLength) {
      totalVariableQuantifiers++;
      if (totalVariableQuantifiers > 4) return false;
    }

    if (q.isUnbounded) {
      totalUnboundedQuantifiers++;
      // Reject >2 unbounded quantifiers globally AND any adjacent repeating atoms (e.g. a+a+, .*.*)
      if (totalUnboundedQuantifiers > 2 || frame.prevAtomRepeating) {
        return false;
      }
    } else if (q.isRepeating && frame.prevAtomRepeating && q.isVariableLength) {
      // Allow e.g. [A-Z]{2,6}\d{3,10} (bounded <= 4 variable quantifiers), handled by variable cap
    }

    frame.prevAtomRepeating = q.isUnbounded;
    return true;
  };

  while (i < p.length) {
    const ch = p[i]!;
    const frame = stack[stack.length - 1]!;

    // Character class [...]
    if (ch === '[') {
      let j = i + 1;
      if (j < p.length && p[j] === '^') j++;
      if (j < p.length && p[j] === ']') j++;
      while (j < p.length && p[j] !== ']') {
        if (p[j] === '\\') j++;
        j++;
      }
      if (j >= p.length) {
        return { ok: false, reason: 'Cú pháp Regex không hợp lệ' };
      }
      i = j + 1;
      const q = readQuantifierAt(p, i);
      if (!applyAtomQuantifier(frame, q)) {
        return { ok: false, reason: redosReason };
      }
      if (q) i = q.endIndex;
      continue;
    }

    // Escape sequence
    if (ch === '\\') {
      const next = p[i + 1];
      if (!next) {
        return { ok: false, reason: 'Cú pháp Regex không hợp lệ' };
      }
      // Reject numeric and named backreferences (\1..\9, \k<name>)
      if ((next >= '1' && next <= '9') || next === 'k') {
        return { ok: false, reason: redosReason };
      }
      i += 2;
      const q = readQuantifierAt(p, i);
      if (!applyAtomQuantifier(frame, q)) {
        return { ok: false, reason: redosReason };
      }
      if (q) i = q.endIndex;
      continue;
    }

    // Group open
    if (ch === '(') {
      if (stack.length >= 8) {
        return { ok: false, reason: redosReason };
      }
      frame.prevAtomRepeating = false;
      stack.push({
        hasAnyQuantifier: false,
        hasAlternation: false,
        prevAtomRepeating: false,
      });
      i++;
      // Skip non-capturing/lookaround/named group prefix
      if (p[i] === '?') {
        if (p[i + 1] === ':' || p[i + 1] === '=' || p[i + 1] === '!') {
          i += 2;
        } else if (p[i + 1] === '<' && (p[i + 2] === '=' || p[i + 2] === '!')) {
          i += 3;
        } else if (p[i + 1] === '<') {
          const closeAngle = p.indexOf('>', i + 2);
          if (closeAngle > i + 2) {
            i = closeAngle + 1;
          }
        }
      }
      continue;
    }

    // Group close
    if (ch === ')') {
      if (stack.length <= 1) {
        return { ok: false, reason: 'Cú pháp Regex không hợp lệ' };
      }
      const closed = stack.pop()!;
      const parent = stack[stack.length - 1]!;
      i++;
      const q = readQuantifierAt(p, i);
      if (q) {
        if (q.excessive) return { ok: false, reason: redosReason };
        // Reject any repeated group containing ANY quantifier (incl. `?`/`{0,1}`) or alternation
        if (q.isRepeating && (closed.hasAnyQuantifier || closed.hasAlternation)) {
          return { ok: false, reason: redosReason };
        }
        if (!applyAtomQuantifier(parent, q)) {
          return { ok: false, reason: redosReason };
        }
        i = q.endIndex;
      } else {
        parent.prevAtomRepeating = false;
      }
      // Propagate inner complexity up so outer nested groups like ((a)+)+, ((a?)a)+, ((a|aa))+ are caught
      if (closed.hasAnyQuantifier) parent.hasAnyQuantifier = true;
      if (closed.hasAlternation) parent.hasAlternation = true;
      continue;
    }

    // Alternation
    if (ch === '|') {
      frame.hasAlternation = true;
      frame.prevAtomRepeating = false;
      i++;
      continue;
    }

    // Dot wildcard or literal atom
    i++;
    const q = readQuantifierAt(p, i);
    if (!applyAtomQuantifier(frame, q)) {
      return { ok: false, reason: redosReason };
    }
    if (q) i = q.endIndex;
  }

  if (totalQuantifiers > 8) {
    return { ok: false, reason: redosReason };
  }

  try {
    new RegExp(p);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Cú pháp Regex không hợp lệ' };
  }
}

export function validatePasswordStrength(
  password: string
): { ok: true } | { ok: false; reason: string } {
  const p = String(password || '');
  if (p.length < 8) {
    return { ok: false, reason: 'Mật khẩu phải có ít nhất 8 ký tự' };
  }
  if (p.length > 128) {
    return { ok: false, reason: 'Mật khẩu tối đa 128 ký tự' };
  }
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) {
    return { ok: false, reason: 'Mật khẩu cần chứa ít nhất 1 chữ cái và 1 chữ số' };
  }
  return { ok: true };
}
