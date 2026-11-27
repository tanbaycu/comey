PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  is_test INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id, revoked_at);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_code TEXT NOT NULL,
  bank_bin TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  inbound_alias TEXT NOT NULL UNIQUE,
  apps_script_token_hash TEXT NOT NULL UNIQUE,
  apps_script_url TEXT,
  apps_script_secret_enc TEXT,
  forwarding_status TEXT NOT NULL DEFAULT 'pending',
  forwarding_confirm_code TEXT,
  forwarding_confirm_url TEXT,
  forwarding_requester_email TEXT,
  strict_auth INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, bank_code, account_number)
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_workspace ON bank_accounts(workspace_id);

CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  match_type TEXT NOT NULL,
  pattern TEXT,
  case_sensitive INTEGER NOT NULL DEFAULT 0,
  webhook_url TEXT NOT NULL,
  webhook_secret_enc TEXT NOT NULL,
  stop_on_match INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_account ON routing_rules(bank_account_id, enabled, priority);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_bin TEXT NOT NULL,
  bank_tx_id TEXT NOT NULL,
  account_number TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  content TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  sender_name TEXT,
  sender_bank TEXT,
  source TEXT NOT NULL,
  email_message_id TEXT,
  raw_hash TEXT NOT NULL,
  auth_status TEXT NOT NULL,
  auth_dkim_domain TEXT,
  matched_order_code TEXT,
  matched_session_id TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(bank_account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_transactions_workspace_created ON transactions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_order_code ON transactions(workspace_id, matched_order_code);

CREATE TABLE IF NOT EXISTS payment_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  short_id TEXT NOT NULL UNIQUE,
  order_code TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_bin TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  expected_amount INTEGER NOT NULL,
  received_amount INTEGER NOT NULL DEFAULT 0,
  exact_match_only INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  overpaid INTEGER NOT NULL DEFAULT 0,
  excess_amount INTEGER NOT NULL DEFAULT 0,
  missing_amount INTEGER NOT NULL DEFAULT 0,
  matched_tx_id TEXT,
  webhook_url TEXT,
  webhook_secret_enc TEXT,
  return_url TEXT,
  metadata_json TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status_expires ON payment_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_account_order ON payment_sessions(bank_account_id, order_code);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  webhook_secret_enc TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  transaction_id TEXT,
  session_id TEXT,
  routing_rule_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  last_http_status INTEGER,
  last_error TEXT,
  last_response_body TEXT,
  next_retry_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_workspace ON webhook_deliveries(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quarantine_emails (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  bank_code TEXT,
  sender TEXT NOT NULL,
  subject TEXT,
  reason TEXT NOT NULL,
  auth_status TEXT NOT NULL,
  auth_json TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  raw_snippet TEXT,
  status TEXT NOT NULL DEFAULT 'quarantined',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quarantine_expires ON quarantine_emails(expires_at);
CREATE INDEX IF NOT EXISTS idx_quarantine_workspace ON quarantine_emails(workspace_id, status, created_at DESC);
