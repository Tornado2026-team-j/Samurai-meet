ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS app_redirect_uri TEXT;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS handoff_challenge TEXT;

CREATE TABLE IF NOT EXISTS oauth_handoffs (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_handoffs_expiry ON oauth_handoffs (expires_at);
