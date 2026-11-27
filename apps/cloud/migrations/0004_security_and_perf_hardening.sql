-- Security & Performance Hardening Migration (0004)

-- 1. Missing performance indexes identified by EXPLAIN QUERY PLAN (PERF-H4)
CREATE INDEX IF NOT EXISTS idx_payment_sessions_ws_created
  ON payment_sessions(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_ws_status_created
  ON payment_sessions(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_acct_status_created
  ON payment_sessions(bank_account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_transactions_ws_order_created
  ON transactions(workspace_id, matched_order_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_account_created
  ON transactions(bank_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ws_status_created
  ON webhook_deliveries(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_routing_rules_workspace_priority
  ON routing_rules(workspace_id, priority);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner
  ON workspaces(owner_user_id, created_at);

-- Drop redundant index that duplicated UNIQUE(kiosk_token)
DROP INDEX IF EXISTS idx_soundboxes_token;

-- 2. Soundbox security hardening: explicit scope isolation & hashed kiosk tokens (SEC-H4)
ALTER TABLE soundboxes ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';
UPDATE soundboxes SET scope = 'account' WHERE bank_account_id IS NOT NULL;
ALTER TABLE soundboxes ADD COLUMN kiosk_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_soundboxes_token_hash
  ON soundboxes(kiosk_token_hash)
  WHERE kiosk_token_hash IS NOT NULL;

-- 3. Sandbox isolation on payment_sessions (CRIT-3)
ALTER TABLE payment_sessions ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

-- 4. Normalize existing data for index-backed queries
UPDATE transactions
  SET matched_order_code = UPPER(matched_order_code)
  WHERE matched_order_code IS NOT NULL
    AND matched_order_code != UPPER(matched_order_code);

UPDATE webhook_deliveries
  SET next_retry_at = created_at
  WHERE status = 'pending' AND next_retry_at IS NULL;
