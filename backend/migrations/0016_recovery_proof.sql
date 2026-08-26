ALTER TABLE key_envelopes
    ADD COLUMN IF NOT EXISTS recovery_public_key TEXT;

CREATE TABLE IF NOT EXISTS recovery_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    pre_auth_token_hash TEXT,
    pre_auth_scope TEXT,
    key_version TEXT NOT NULL,
    recovery_public_key TEXT NOT NULL,
    challenge_hash TEXT NOT NULL UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL,
    CHECK ((source_session_id IS NOT NULL AND pre_auth_token_hash IS NULL AND pre_auth_scope IS NULL)
        OR (source_session_id IS NULL AND pre_auth_token_hash IS NOT NULL AND pre_auth_scope IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_recovery_challenges_expiry
    ON recovery_challenges (expires_at, used_at);

CREATE INDEX IF NOT EXISTS idx_recovery_challenges_pre_auth
    ON recovery_challenges (pre_auth_token_hash, used_at);
