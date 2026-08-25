CREATE TABLE IF NOT EXISTS passkey_bootstraps (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id),
    source_session_id TEXT REFERENCES sessions(id),
    source_pre_auth_hash TEXT,
    scope TEXT NOT NULL CHECK (scope IN ('passkey_register', 'passkey_login', 'passkey_reauth')),
    app_redirect_uri TEXT NOT NULL,
    handoff_challenge TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL,
    CHECK ((source_session_id IS NOT NULL AND source_pre_auth_hash IS NULL) OR (source_session_id IS NULL AND source_pre_auth_hash IS NOT NULL)),
    CHECK (scope <> 'passkey_reauth' OR source_session_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_passkey_bootstraps_active
    ON passkey_bootstraps (token_hash, used_at, expires_at);
