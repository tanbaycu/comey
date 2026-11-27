ALTER TABLE api_keys ADD COLUMN description TEXT;
ALTER TABLE api_keys ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '["*"]';
ALTER TABLE api_keys ADD COLUMN rate_limit_rpm INTEGER NOT NULL DEFAULT 120;
ALTER TABLE api_keys ADD COLUMN allowed_ips TEXT;
ALTER TABLE api_keys ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
ALTER TABLE api_keys ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN last_ip_hash TEXT;
ALTER TABLE api_keys ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS api_request_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  ip_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_ws_created ON api_request_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_key_created ON api_request_logs(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created ON api_request_logs(created_at);
