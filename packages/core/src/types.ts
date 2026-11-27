export type BankCode =
  | 'CAKE'
  | 'TIMO'
  | 'TPBANK'
  | 'TECHCOMBANK'
  | 'VIB'
  | 'MB'
  | 'ACB'
  | 'VCB'
  | 'VPBANK'
  | 'SACOMBANK'
  | 'BIDV'
  | 'VIETINBANK'
  | (string & {});

export interface BankMetadata {
  code: BankCode;
  bin: string;
  name: string;
  shortName: string;
  color: string;
  logoUrl: string;
  emailDomains: string[];
  dkimDomains: string[];
}

export type EmailSource = 'email_worker' | 'apps_script' | 'imap' | 'simulator';

export type EmailAuthStatus = 'verified' | 'unverified' | 'spoof_suspected' | 'simulated';

export interface EmailAuthResult {
  status: EmailAuthStatus;
  dkimPass: boolean;
  dkimDomain: string | null;
  spfPass: boolean;
  dmarcPass: boolean;
  arcPass: boolean;
  envelopeFrom: string | null;
  headerFrom: string | null;
  reasons: string[];
}

export interface RawEmailInput {
  source: EmailSource;
  messageId?: string;
  from: string;
  to?: string;
  envelopeFrom?: string;
  subject?: string;
  date?: string;
  htmlBody?: string;
  textBody?: string;
  headers?: Record<string, string | string[]>;
  rawMime?: string;
  authenticationResults?: string | string[];
}

export interface UnifiedTransaction {
  id: string;
  bankCode: BankCode;
  bankBin: string;
  txId: string;
  accountNumber: string;
  direction: 'in' | 'out';
  amount: number;
  currency: 'VND';
  content: string;
  occurredAt: string;
  senderName?: string;
  senderBank?: string;
  source: EmailSource;
  emailMessageId?: string;
  rawHash: string;
  auth: EmailAuthResult;
  isTest: boolean;
}

export type ParsedBankTransaction = Omit<
  UnifiedTransaction,
  'id' | 'source' | 'rawHash' | 'auth' | 'isTest'
>;

export type ParseResult =
  | {
      ok: true;
      transaction: ParsedBankTransaction;
    }
  | {
      ok: false;
      ignored?: boolean;
      outgoing?: boolean;
      quarantine?: boolean;
      reason: string;
      debugLines?: string[];
    };

export interface BankEmailParser {
  readonly bank: BankMetadata;
  canHandle(email: RawEmailInput): boolean;
  parse(email: RawEmailInput, expectedAccountNo?: string): ParseResult;
}

export interface GmailForwardingConfirmation {
  isForwardingConfirmation: boolean;
  confirmationCode?: string;
  confirmationUrl?: string;
  requesterEmail?: string;
}

export type EmailProcessOutcome =
  | {
      outcome: 'parsed';
      transaction: UnifiedTransaction;
    }
  | {
      outcome: 'quarantined';
      reason: string;
      bankCode?: BankCode;
      rawHash: string;
      auth: EmailAuthResult;
      debugLines?: string[];
    }
  | {
      outcome: 'ignored';
      reason: string;
      bankCode?: BankCode;
      rawHash: string;
    }
  | {
      outcome: 'forwarding_confirmation';
      confirmation: GmailForwardingConfirmation;
      rawHash: string;
    };

export interface RoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchType: 'prefix' | 'regex' | 'all';
  pattern?: string;
  caseSensitive?: boolean;
  webhookUrl: string;
  stopOnMatch?: boolean;
}

export interface RouteMatchResult {
  rule: RoutingRule;
  extractedCode?: string;
}

export type PaymentSessionStatus =
  | 'pending'
  | 'paid'
  | 'underpaid'
  | 'overpaid_review'
  | 'expired'
  | 'cancelled';

export interface PaymentSession {
  id: string;
  shortId: string;
  orderCode: string;
  bankCode: BankCode;
  bankBin: string;
  accountNumber: string;
  accountName: string;
  expectedAmount: number;
  receivedAmount: number;
  exactMatchOnly: boolean;
  status: PaymentSessionStatus;
  overpaid: boolean;
  excessAmount: number;
  missingAmount: number;
  matchedTxId?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  cancelledAt?: string;
  metadata?: Record<string, unknown>;
}

export type WebhookEventType =
  | 'transaction.received'
  | 'session.paid'
  | 'session.underpaid'
  | 'session.overpaid_review'
  | 'session.expired'
  | 'session.late_payment'
  | 'email.quarantined';

export interface WebhookEvent<T = unknown> {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  isTest: boolean;
  data: T;
}

export interface StorageAdapter {
  hasProcessedTx(txId: string): Promise<boolean>;
  markProcessedTx(txId: string, ttlSeconds?: number): Promise<void>;
  saveTransaction(tx: UnifiedTransaction): Promise<void>;
  getTransaction(id: string): Promise<UnifiedTransaction | null>;
  getSessionByOrderCode(orderCode: string): Promise<PaymentSession | null>;
  getSessionByShortId(shortId: string): Promise<PaymentSession | null>;
  saveSession(session: PaymentSession): Promise<void>;
}
