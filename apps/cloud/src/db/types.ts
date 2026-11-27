import type {
  PaymentSession,
  PaymentSessionStatus,
  RoutingRule,
  WebhookPayloadFormat,
} from '@comey/core';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceRow {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: string;
}

export interface BankAccountRow {
  id: string;
  workspace_id: string;
  bank_code: string;
  bank_bin: string;
  account_number: string;
  account_name: string;
  inbound_alias: string;
  apps_script_token_hash: string;
  apps_script_url: string | null;
  apps_script_secret_enc: string | null;
  forwarding_status: string;
  forwarding_confirm_code: string | null;
  forwarding_confirm_url: string | null;
  forwarding_requester_email: string | null;
  strict_auth: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface RoutingRuleRow {
  id: string;
  workspace_id: string;
  bank_account_id: string;
  name: string;
  enabled: number;
  priority: number;
  match_type: 'prefix' | 'regex' | 'all';
  pattern: string | null;
  case_sensitive: number;
  webhook_url: string;
  webhook_secret_enc: string;
  payload_format: WebhookPayloadFormat;
  stop_on_match: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  workspace_id: string;
  bank_account_id: string;
  idempotency_key: string;
  bank_code: string;
  bank_bin: string;
  bank_tx_id: string;
  account_number: string;
  direction: 'in' | 'out';
  amount: number;
  currency: string;
  content: string;
  occurred_at: string;
  sender_name: string | null;
  sender_bank: string | null;
  source: string;
  email_message_id: string | null;
  raw_hash: string;
  auth_status: string;
  auth_dkim_domain: string | null;
  matched_order_code: string | null;
  matched_session_id: string | null;
  is_test: number;
  created_at: string;
}

export interface PaymentSessionRow {
  id: string;
  workspace_id: string;
  bank_account_id: string;
  short_id: string;
  order_code: string;
  bank_code: string;
  bank_bin: string;
  account_number: string;
  account_name: string;
  expected_amount: number;
  received_amount: number;
  exact_match_only: number;
  status: PaymentSessionStatus;
  overpaid: number;
  excess_amount: number;
  missing_amount: number;
  matched_tx_id: string | null;
  webhook_url: string | null;
  webhook_secret_enc: string | null;
  return_url: string | null;
  metadata_json: string | null;
  expires_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  is_test: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryRow {
  id: string;
  workspace_id: string;
  event_id: string;
  event_type: string;
  target_url: string;
  webhook_secret_enc: string;
  payload_format: WebhookPayloadFormat;
  payload_json: string;
  transaction_id: string | null;
  session_id: string | null;
  routing_rule_id: string | null;
  status: 'pending' | 'delivered' | 'retrying' | 'failed';
  attempt_count: number;
  max_attempts: number;
  last_http_status: number | null;
  last_error: string | null;
  last_response_body: string | null;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuarantineEmailRow {
  id: string;
  workspace_id: string;
  bank_account_id: string | null;
  source: string;
  bank_code: string | null;
  sender: string;
  subject: string | null;
  reason: string;
  auth_status: string;
  auth_json: string;
  raw_hash: string;
  raw_snippet: string | null;
  status: 'quarantined' | 'dismissed';
  expires_at: string;
  created_at: string;
}

export interface SoundboxRow {
  id: string;
  workspace_id: string;
  bank_account_id: string | null;
  scope: 'all' | 'account';
  name: string;
  kiosk_token: string;
  kiosk_token_hash: string | null;
  voice_lang: string;
  voice_template: string;
  min_amount: number;
  enabled: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudPaymentSession extends PaymentSession {
  bankAccountId: string;
  isTest: boolean;
}

export function rowToRoutingRule(row: RoutingRuleRow): RoutingRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    priority: row.priority,
    matchType: row.match_type,
    pattern: row.pattern ?? undefined,
    caseSensitive: row.case_sensitive === 1,
    webhookUrl: row.webhook_url,
    stopOnMatch: row.stop_on_match === 1,
  };
}

export function rowToPaymentSession(row: PaymentSessionRow): CloudPaymentSession {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    shortId: row.short_id,
    orderCode: row.order_code,
    bankCode: row.bank_code,
    bankBin: row.bank_bin,
    accountNumber: row.account_number,
    accountName: row.account_name,
    expectedAmount: row.expected_amount,
    receivedAmount: row.received_amount,
    exactMatchOnly: row.exact_match_only === 1,
    status: row.status,
    overpaid: row.overpaid === 1,
    excessAmount: row.excess_amount,
    missingAmount: row.missing_amount,
    matchedTxId: row.matched_tx_id ?? undefined,
    isTest: row.is_test === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    metadata,
  };
}
