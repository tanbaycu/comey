import type {
  EmailAuthResult,
  GmailForwardingConfirmation,
  RawEmailInput,
} from '../types.js';

export const DEFAULT_TRUSTED_ARC_DOMAINS = ['google.com'];

/**
 * Strip RFC 5322 quoted strings ("...") and nested comments ((...)) so
 * display names or comments cannot smuggle spoofed angle-bracketed addresses.
 * Unclosed quotes/comments fail closed by dropping the remainder.
 */
function stripRfc5322QuotedAndComments(input: string): string {
  let out = '';
  let inQuotes = false;
  let commentDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      }
      continue;
    }
    if (commentDepth > 0) {
      if (ch === '\\') {
        i++;
      } else if (ch === '(') {
        commentDepth++;
      } else if (ch === ')') {
        commentDepth--;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      out += ' ';
    } else if (ch === '(') {
      commentDepth = 1;
      out += ' ';
    } else {
      out += ch;
    }
  }

  return out;
}

const ANGLE_ADDR_RE =
  /<\s*([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})\s*>/gi;
const PLAIN_ADDR_RE =
  /([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})/gi;

export function extractEmailAddress(headerValue?: string): string | null {
  const raw = String(headerValue || '').trim();
  if (!raw) return null;

  const stripped = stripRfc5322QuotedAndComments(raw).trim();
  if (!stripped) return null;

  if (stripped.includes('<') || stripped.includes('>')) {
    ANGLE_ADDR_RE.lastIndex = 0;
    let lastMatch: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = ANGLE_ADDR_RE.exec(stripped)) !== null) {
      if (m[1]) lastMatch = m[1].trim().toLowerCase();
    }
    return lastMatch;
  }

  PLAIN_ADDR_RE.lastIndex = 0;
  let lastPlain: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = PLAIN_ADDR_RE.exec(stripped)) !== null) {
    if (m[1]) lastPlain = m[1].trim().toLowerCase();
  }
  return lastPlain;
}

export function extractDomain(headerValue?: string): string | null {
  const email = extractEmailAddress(headerValue);
  if (email) {
    const atIdx = email.lastIndexOf('@');
    return atIdx >= 0 ? email.slice(atIdx + 1).toLowerCase() : null;
  }
  const raw = String(headerValue || '').trim().toLowerCase();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) {
    return raw;
  }
  return null;
}

export function domainMatchesAllowed(domain: string | null, allowedDomains: string[]): boolean {
  if (!domain) return false;
  const cleanDomain = domain.trim().toLowerCase().replace(/^@/, '');
  if (!cleanDomain) return false;

  for (const allowedRaw of allowedDomains) {
    const allowed = allowedRaw.trim().toLowerCase().replace(/^@/, '');
    if (!allowed) continue;
    if (cleanDomain === allowed || cleanDomain.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

export interface ParsedAuthHeaders {
  dkimResults: Array<{ result: string; domain: string | null }>;
  spfPass: boolean;
  dmarcPass: boolean;
  arcPass: boolean;
}

export interface ParseAuthResultsOptions {
  /** Optional allowlist of trusted authserv-id hostnames/domains (e.g. ['cloudflare.net', 'google.com']). */
  trustedAuthservIds?: string[];
}

export interface VerifyBankEmailAuthOptions {
  /** Optional allowlist of trusted authserv-id hostnames/domains for Authentication-Results. */
  trustedAuthservIds?: string[];
  /** Trusted ARC-Seal d= forwarder domains. Defaults to ['google.com']. */
  trustedArcDomains?: string[];
}

function extractAuthservId(normalizedHeader: string): string | null {
  const segments = normalizedHeader.split(';');
  if (segments.length === 0) return null;
  let candidate = stripRfc5322QuotedAndComments(segments[0] ?? '').trim();
  if (/^i\s*=\s*\d+$/i.test(candidate)) {
    candidate = stripRfc5322QuotedAndComments(segments[1] ?? '').trim();
  }
  const firstToken = candidate.split(/[\s/]+/)[0]?.trim().toLowerCase() || '';
  return firstToken || null;
}

function parseSingleAuthenticationResultsHeader(headerVal: string): ParsedAuthHeaders {
  const dkimResults: Array<{ result: string; domain: string | null }> = [];
  let spfPass = false;
  let dmarcPass = false;
  let arcPass = false;

  const normalized = String(headerVal || '').replace(/\r?\n[ \t]+/g, ' ');
  const segments = normalized.split(';');
  for (const seg of segments) {
    const s = seg.trim();
    if (!s) continue;

    const dkimMatch = s.match(/\bdkim=(pass|fail|neutral|policy|temperror|permerror|none)\b/i);
    if (dkimMatch?.[1]) {
      const result = dkimMatch[1].toLowerCase();
      const domainMatch = s.match(/\bheader\.d=([^\s;]+)/i);
      const identityMatch = s.match(/\bheader\.i=@?([^\s;]+)/i);
      const domain = (domainMatch?.[1] || identityMatch?.[1] || '').trim().toLowerCase() || null;
      dkimResults.push({ result, domain });
    }

    if (/\bspf=pass\b/i.test(s)) {
      spfPass = true;
    }
    if (/\bdmarc=pass\b/i.test(s)) {
      dmarcPass = true;
    }
    if (/\barc=pass\b/i.test(s)) {
      arcPass = true;
    }
  }

  return { dkimResults, spfPass, dmarcPass, arcPass };
}

/**
 * Inspects ONLY the single topmost Authentication-Results header (MTAs prepend at the top)
 * so forged lower headers injected by an attacker can never override an upper MTA verdict.
 */
export function parseAuthenticationResults(
  headers: string[],
  options?: ParseAuthResultsOptions
): ParsedAuthHeaders {
  const topmost = headers.map((h) => String(h || '').trim()).find(Boolean);
  if (!topmost) {
    return { dkimResults: [], spfPass: false, dmarcPass: false, arcPass: false };
  }

  const normalized = topmost.replace(/\r?\n[ \t]+/g, ' ').trim();
  if (options?.trustedAuthservIds && options.trustedAuthservIds.length > 0) {
    const authservId = extractAuthservId(normalized);
    if (!domainMatchesAllowed(authservId, options.trustedAuthservIds)) {
      return { dkimResults: [], spfPass: false, dmarcPass: false, arcPass: false };
    }
  }

  return parseSingleAuthenticationResultsHeader(normalized);
}

function getHeaderValues(
  headers: Record<string, string | string[]> | undefined,
  name: string
): string[] {
  if (!headers) return [];
  const target = name.toLowerCase();
  const out: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item) out.push(String(item));
        }
      } else if (v) {
        out.push(String(v));
      }
    }
  }
  return out;
}

function extractArcInstance(headerVal: string): number | null {
  const normalized = String(headerVal || '').replace(/\r?\n[ \t]+/g, ' ');
  const m = normalized.match(/(?:^|;|\s)i\s*=\s*(\d+)\b/i);
  if (!m?.[1]) return null;
  const parsed = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseTrustedArcAuthResults(
  arcSealHeaders: string[],
  arcAuthHeaders: string[],
  trustedArcDomains: string[]
): ParsedAuthHeaders | null {
  if (arcSealHeaders.length === 0 || arcAuthHeaders.length === 0) {
    return null;
  }

  // Record topmost ARC-Seal per instance i=N, only trusting instances signed by an allowed d= domain with cv != fail.
  const seenSealInstances = new Set<number>();
  const trustedInstances = new Set<number>();

  for (const sealRaw of arcSealHeaders) {
    const normalized = String(sealRaw || '').replace(/\r?\n[ \t]+/g, ' ');
    const instance = extractArcInstance(normalized);
    if (instance === null || seenSealInstances.has(instance)) continue;
    seenSealInstances.add(instance);

    const cvMatch = normalized.match(/(?:^|;|\s)cv\s*=\s*([a-z]+)\b/i);
    if (cvMatch?.[1]?.toLowerCase() === 'fail') continue;

    const dMatch = normalized.match(/(?:^|;|\s)d\s*=\s*([^\s;]+)/i);
    const signerDomain = dMatch?.[1]?.trim().toLowerCase() || null;
    if (domainMatchesAllowed(signerDomain, trustedArcDomains)) {
      trustedInstances.add(instance);
    }
  }

  if (trustedInstances.size === 0) {
    return null;
  }

  // Only inspect the single topmost ARC-Authentication-Results header bound to a trusted ARC-Seal instance.
  for (const aarRaw of arcAuthHeaders) {
    const instance = extractArcInstance(aarRaw);
    if (instance !== null && trustedInstances.has(instance)) {
      return parseSingleAuthenticationResultsHeader(aarRaw);
    }
  }

  return null;
}

export function verifyBankEmailAuth(
  email: RawEmailInput,
  allowedDkimDomains: string[],
  allowedSenderDomains?: string[],
  options?: VerifyBankEmailAuthOptions
): EmailAuthResult {
  const headerFrom = extractEmailAddress(email.from);
  const headerFromDomain = extractDomain(email.from);
  const envelopeFrom = extractEmailAddress(email.envelopeFrom);
  const senderWhitelist =
    allowedSenderDomains && allowedSenderDomains.length > 0
      ? allowedSenderDomains
      : allowedDkimDomains;

  if (email.source === 'simulator') {
    return {
      status: 'simulated',
      dkimPass: true,
      dkimDomain: allowedDkimDomains[0] ?? null,
      spfPass: true,
      dmarcPass: true,
      arcPass: false,
      envelopeFrom,
      headerFrom,
      reasons: ['Simulated transaction'],
    };
  }

  const reasons: string[] = [];
  const directAuthHeaders: string[] = [];
  if (Array.isArray(email.authenticationResults)) {
    directAuthHeaders.push(...email.authenticationResults.filter(Boolean));
  } else if (email.authenticationResults) {
    directAuthHeaders.push(email.authenticationResults);
  }
  directAuthHeaders.push(...getHeaderValues(email.headers, 'authentication-results'));

  const directParsed = parseAuthenticationResults(directAuthHeaders, {
    trustedAuthservIds: options?.trustedAuthservIds,
  });

  const trustedArcDomains =
    options?.trustedArcDomains && options.trustedArcDomains.length > 0
      ? options.trustedArcDomains
      : DEFAULT_TRUSTED_ARC_DOMAINS;

  const arcSealHeaders = getHeaderValues(email.headers, 'arc-seal');
  const arcAuthHeaders = getHeaderValues(email.headers, 'arc-authentication-results');
  const trustedArcParsed = directParsed.arcPass
    ? parseTrustedArcAuthResults(arcSealHeaders, arcAuthHeaders, trustedArcDomains)
    : null;

  const senderAligned = domainMatchesAllowed(headerFromDomain, senderWhitelist);
  if (!senderAligned) {
    reasons.push(`Header From domain (${headerFromDomain || 'none'}) does not match allowed bank domains`);
  }

  const hasExplicitDkimFail =
    directParsed.dkimResults.some((entry) => entry.result === 'fail') ||
    Boolean(trustedArcParsed?.dkimResults.some((entry) => entry.result === 'fail'));

  const directAlignedDkim = directParsed.dkimResults.find(
    (entry) => entry.result === 'pass' && domainMatchesAllowed(entry.domain, allowedDkimDomains)
  );

  const arcAlignedDkim =
    directParsed.arcPass && trustedArcParsed
      ? trustedArcParsed.dkimResults.find(
          (entry) => entry.result === 'pass' && domainMatchesAllowed(entry.domain, allowedDkimDomains)
        )
      : undefined;

  const matchedDkim = hasExplicitDkimFail ? undefined : directAlignedDkim || arcAlignedDkim;
  const dkimPass = Boolean(matchedDkim);
  const dkimDomain = matchedDkim?.domain ?? null;

  const hasUnalignedDkimPass = directParsed.dkimResults.some(
    (entry) => entry.result === 'pass' && !domainMatchesAllowed(entry.domain, allowedDkimDomains)
  );

  if (hasExplicitDkimFail) {
    reasons.push('DKIM signature failed verification');
  } else if (!dkimPass) {
    if (hasUnalignedDkimPass) {
      const signedBy = directParsed.dkimResults
        .filter((e) => e.result === 'pass')
        .map((e) => e.domain || 'unknown')
        .join(', ');
      reasons.push(`DKIM passed for unaligned domain (${signedBy}) instead of bank domain`);
    } else if (directAuthHeaders.length === 0) {
      reasons.push('Missing Authentication-Results header');
    } else if (directParsed.arcPass && !trustedArcParsed && arcAuthHeaders.length > 0) {
      reasons.push('ARC-Authentication-Results rejected: missing trusted ARC-Seal domain');
    } else {
      reasons.push('No aligned DKIM=pass found for allowed bank domain');
    }
  }

  let status: EmailAuthResult['status'];
  if (hasExplicitDkimFail) {
    status = 'spoof_suspected';
  } else if (senderAligned && dkimPass) {
    status = 'verified';
  } else if (!senderAligned || hasUnalignedDkimPass) {
    status = 'spoof_suspected';
  } else {
    status = 'unverified';
  }

  return {
    status,
    dkimPass,
    dkimDomain,
    spfPass: directParsed.spfPass || Boolean(trustedArcParsed?.spfPass),
    dmarcPass: directParsed.dmarcPass || Boolean(trustedArcParsed?.dmarcPass),
    arcPass: directParsed.arcPass && Boolean(trustedArcParsed),
    envelopeFrom,
    headerFrom,
    reasons,
  };
}

export function detectGmailForwardingConfirmation(
  email: RawEmailInput
): GmailForwardingConfirmation {
  const fromAddr = extractEmailAddress(email.from) || '';
  const fromDomain = extractDomain(email.from);
  if (fromAddr !== 'forwarding-noreply@google.com' && fromDomain !== 'google.com') {
    return { isForwardingConfirmation: false };
  }

  const subject = String(email.subject || '');
  const combinedBody = `${subject}\n${email.textBody || ''}\n${email.htmlBody || ''}`;
  const looksLikeForwarding =
    /forwarding confirmation|xác nhận chuyển tiếp|mail-settings\.google\.com\/mail\/vf-/i.test(
      combinedBody
    );

  if (!looksLikeForwarding) {
    return { isForwardingConfirmation: false };
  }

  // Always fail closed: require verified DKIM=pass aligned with google.com
  const auth = verifyBankEmailAuth(email, ['google.com'], ['google.com']);
  if (
    auth.status !== 'verified' ||
    !auth.dkimPass ||
    !domainMatchesAllowed(auth.dkimDomain, ['google.com'])
  ) {
    return { isForwardingConfirmation: false };
  }

  const urlMatch = combinedBody.match(/https:\/\/mail-settings\.google\.com\/mail\/vf-[^\s"'<>]+/i);
  const codeMatch =
    subject.match(/\b(\d{9})\b/) ||
    combinedBody.match(/(?:confirmation code|mã xác nhận)[^0-9]{0,40}(\d{6,10})/i) ||
    combinedBody.match(/\b(\d{9})\b/);

  const requesterMatch = combinedBody.match(
    /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+(?:has requested|đã yêu cầu|wants to)/i
  );

  return {
    isForwardingConfirmation: true,
    confirmationCode: codeMatch?.[1],
    confirmationUrl: urlMatch?.[0],
    requesterEmail: requesterMatch?.[1]?.toLowerCase(),
  };
}
