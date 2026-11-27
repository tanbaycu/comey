import { sha256Hex } from '../security/crypto.js';
import {
  detectGmailForwardingConfirmation,
  verifyBankEmailAuth,
} from '../security/emailAuth.js';
import type {
  BankCode,
  BankEmailParser,
  EmailProcessOutcome,
  RawEmailInput,
} from '../types.js';
import { cakeEmailParser } from './cake.js';
import { parseRawMimeEmail } from './mime.js';
import {
  acbEmailParser,
  mbEmailParser,
  techcombankEmailParser,
  timoEmailParser,
  vcbEmailParser,
} from './vietnamBanks.js';

export class BankParserRegistry {
  private readonly parsers = new Map<BankCode, BankEmailParser>();

  register(parser: BankEmailParser): this {
    this.parsers.set(parser.bank.code, parser);
    return this;
  }

  get(bankCode: BankCode): BankEmailParser | undefined {
    return this.parsers.get(bankCode);
  }

  list(): BankEmailParser[] {
    return Array.from(this.parsers.values());
  }

  findMatchingParsers(email: RawEmailInput): BankEmailParser[] {
    return this.list().filter((p) => p.canHandle(email));
  }
}

export function createDefaultParserRegistry(): BankParserRegistry {
  return new BankParserRegistry()
    .register(cakeEmailParser)
    .register(mbEmailParser)
    .register(vcbEmailParser)
    .register(techcombankEmailParser)
    .register(timoEmailParser)
    .register(acbEmailParser);
}

function mergeMimeIntoEmail(email: RawEmailInput): RawEmailInput {
  if (!email.rawMime) return email;
  const parsed = parseRawMimeEmail(email.rawMime);

  const mergedHeaders: Record<string, string | string[]> = { ...parsed.headers };
  if (email.headers) {
    for (const [k, v] of Object.entries(email.headers)) {
      mergedHeaders[k.toLowerCase()] = v;
    }
  }

  // Prefer MIME From: header over SMTP envelope input.from so Gmail auto-forwarding
  // (SMTP envelope user+caf_=@gmail.com + MIME From: no-reply@cake.vn) aligns properly.
  const resolvedFrom = parsed.from || email.from;
  const resolvedEnvelopeFrom =
    email.envelopeFrom ||
    (parsed.from && email.from && email.from !== parsed.from ? email.from : undefined);

  return {
    ...email,
    from: resolvedFrom,
    envelopeFrom: resolvedEnvelopeFrom,
    to: email.to || parsed.to,
    subject: email.subject || parsed.subject,
    date: email.date || parsed.date,
    messageId: email.messageId || parsed.messageId,
    textBody: email.textBody || parsed.textBody,
    htmlBody: email.htmlBody || parsed.htmlBody,
    headers: mergedHeaders,
    authenticationResults:
      email.authenticationResults ?? mergedHeaders['authentication-results'],
  };
}

export interface ProcessEmailOptions {
  registry?: BankParserRegistry;
  expectedAccountNo?: string;
  /** Default true: requires aligned DKIM pass unless source is 'simulator'. */
  strictAuth?: boolean;
}

export async function processIncomingEmail(
  rawInput: RawEmailInput,
  options?: ProcessEmailOptions
): Promise<EmailProcessOutcome> {
  const email = mergeMimeIntoEmail(rawInput);
  const rawMaterial =
    email.rawMime ||
    `${email.from}|${email.subject || ''}|${email.date || ''}|${email.htmlBody || ''}|${email.textBody || ''}`;
  const rawHash = await sha256Hex(rawMaterial);

  const forwarding = detectGmailForwardingConfirmation(email);
  if (forwarding.isForwardingConfirmation) {
    return {
      outcome: 'forwarding_confirmation',
      confirmation: forwarding,
      rawHash,
    };
  }

  const registry = options?.registry ?? createDefaultParserRegistry();
  const candidates = registry.findMatchingParsers(email);
  if (candidates.length === 0) {
    return {
      outcome: 'ignored',
      reason: `No bank parser registered for sender "${email.from}"`,
      rawHash,
    };
  }

  const strictAuth = options?.strictAuth ?? true;
  const parser = candidates[0]!;
  const auth = verifyBankEmailAuth(
    email,
    parser.bank.dkimDomains,
    parser.bank.emailDomains
  );

  if (strictAuth && auth.status !== 'verified' && auth.status !== 'simulated') {
    return {
      outcome: 'quarantined',
      bankCode: parser.bank.code,
      reason: auth.reasons.join('; ') || 'Email failed DKIM/sender verification',
      rawHash,
      auth,
    };
  }

  const parsed = parser.parse(email, options?.expectedAccountNo);
  if (!parsed.ok) {
    if (parsed.quarantine) {
      return {
        outcome: 'quarantined',
        bankCode: parser.bank.code,
        reason: parsed.reason,
        rawHash,
        auth,
        debugLines: parsed.debugLines,
      };
    }
    return {
      outcome: 'ignored',
      bankCode: parser.bank.code,
      reason: parsed.reason,
      rawHash,
    };
  }

  const tx = parsed.transaction;
  return {
    outcome: 'parsed',
    transaction: {
      ...tx,
      id: `${tx.bankCode.toLowerCase()}_${tx.txId.toUpperCase()}`,
      source: email.source,
      rawHash,
      auth,
      isTest: email.source === 'simulator',
    },
  };
}
