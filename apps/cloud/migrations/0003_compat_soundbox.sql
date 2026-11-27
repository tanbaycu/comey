ALTER TABLE routing_rules ADD COLUMN payload_format TEXT NOT NULL DEFAULT 'comey';
ALTER TABLE webhook_deliveries ADD COLUMN payload_format TEXT NOT NULL DEFAULT 'comey';

CREATE TABLE IF NOT EXISTS soundboxes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kiosk_token TEXT NOT NULL UNIQUE,
  voice_lang TEXT NOT NULL DEFAULT 'vi-VN',
  voice_template TEXT NOT NULL DEFAULT 'Đã nhận {amountWords} {currency}',
  min_amount INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_soundboxes_workspace ON soundboxes(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_soundboxes_token ON soundboxes(kiosk_token);
