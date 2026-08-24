CREATE TABLE IF NOT EXISTS pre_auth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL CHECK (scope IN ('passkey_register', 'passkey_login', 'passkey_reauth')),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pre_auth_tokens_active
    ON pre_auth_tokens (user_id, scope, used_at, expires_at);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_passkey_at TEXT;
