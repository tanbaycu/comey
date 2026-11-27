export type WebhookPayloadFormat =
  | 'comey'
  | 'sepay'
  | 'payos'
  | 'telegram'
  | 'discord'
  | 'google_sheets';

export const SANDBOX_WEBHOOK_URL = 'internal://sandbox-inbox';
export const TELEGRAM_URL_PREFIX = 'telegram://chat/';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  created_at?: string;
}

export interface BankCatalogItem {
  code: string;
  bin: string;
  name: string;
  shortName: string;
  color: string;
  logoUrl: string;
  emailDomains: string[];
  dkimDomains: string[];
}

export interface BankAccount {
  id: string;
  bankCode: string;
  bankBin: string;
  accountNumber: string;
  accountName: string;
  inboundAlias: string;
  inboundEmail: string;
  appsScriptUrl: string | null;
  forwardingStatus: string;
  forwardingConfirmCode: string | null;
  forwardingConfirmUrl: string | null;
  forwardingRequesterEmail: string | null;
  strictAuth: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoutingRule {
  id: string;
  bankAccountId: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchType: 'prefix' | 'regex' | 'all';
  pattern: string | null;
  caseSensitive: boolean;
  webhookUrl: string;
  payloadFormat: WebhookPayloadFormat;
  stopOnMatch: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionItem {
  id: string;
  bankAccountId: string;
  bankCode: string;
  bankBin: string;
  bankTxId: string;
  accountNumber: string;
  direction: 'in' | 'out';
  amount: number;
  currency: string;
  content: string;
  occurredAt: string;
  senderName: string | null;
  senderBank: string | null;
  source: string;
  authStatus: string;
  authDkimDomain: string | null;
  matchedOrderCode: string | null;
  matchedSessionId: string | null;
  isTest: boolean;
  createdAt: string;
}

export interface PaymentSessionItem {
  id: string;
  bankAccountId: string;
  shortId: string;
  orderCode: string;
  bankCode: string;
  bankBin: string;
  accountNumber: string;
  accountName: string;
  expectedAmount: number;
  receivedAmount: number;
  exactMatchOnly: boolean;
  status: 'pending' | 'paid' | 'underpaid' | 'overpaid_review' | 'expired' | 'cancelled';
  overpaid: boolean;
  excessAmount: number;
  missingAmount: number;
  matchedTxId?: string;
  isTest?: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  cancelledAt?: string;
}

export interface WebhookDeliveryItem {
  id: string;
  eventId: string;
  eventType: string;
  targetUrl: string;
  payloadFormat: WebhookPayloadFormat;
  transactionId: string | null;
  sessionId: string | null;
  routingRuleId: string | null;
  status: 'pending' | 'delivered' | 'retrying' | 'failed';
  attemptCount: number;
  maxAttempts: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  lastResponseBody: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryDetail extends WebhookDeliveryItem {
  payloadJson: string;
}

export interface SoundboxItem {
  id: string;
  bankAccountId: string | null;
  name: string;
  tokenPreview: string;
  voiceLang: string;
  voiceTemplate: string;
  minAmount: number;
  enabled: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuarantineItem {
  id: string;
  bankAccountId: string | null;
  source: string;
  bankCode: string | null;
  sender: string;
  subject: string | null;
  reason: string;
  authStatus: string;
  rawHash: string;
  rawSnippet: string | null;
  status: 'quarantined' | 'dismissed';
  expiresAt: string;
  createdAt: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  is_test: number;
  scopes: string[];
  rateLimitRpm: number;
  allowedIps: string[];
  enabled: boolean;
  expiresAt: string | null;
  requestCount: number;
  errorCount: number;
  lastIpHash: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updatedAt?: string;
  status: 'active' | 'paused' | 'expired' | 'revoked';
}

export interface ApiRequestLogItem {
  id: string;
  apiKeyId: string;
  apiKeyName: string;
  keyPrefix: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  ipHash: string | null;
  errorCode: string | null;
  createdAt: string;
}

export interface ApiUsageSummary {
  totalRequests24h: number;
  errorRequests24h: number;
  rateLimited24h: number;
  avgLatencyMs: number;
}

export interface SecuritySummary {
  totalAccounts: number;
  strictAuthAccounts: number;
  activeApiKeys: number;
  openQuarantineCount: number;
  retryingDeliveries: number;
  recentAuditCount: number;
  ssrfGuardEnabled: boolean;
  csrfGuardEnabled: boolean;
  redirectBlocked: boolean;
}

export interface AuditLogItem {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipHash: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface SimulationResponse {
  ok: boolean;
  simulation: {
    status: string;
    matchedOrderCode?: string | null;
    sessionAction?: string | null;
    sessionId?: string | null;
    transaction?: {
      id: string;
      bankTxId: string;
      amount: number;
      content: string;
    };
    deliveries?: Array<{
      deliveryId: string;
      eventType: string;
      targetUrl: string;
      status: string;
      httpStatus: number | null;
      error: string | null;
    }>;
    reason?: string;
  };
}
