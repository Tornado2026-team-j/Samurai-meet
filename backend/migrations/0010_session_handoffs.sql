CREATE TABLE IF NOT EXISTS session_handoffs (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    app_redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    response_ciphertext TEXT NOT NULL,
    response_nonce TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_handoffs_expiry
    ON session_handoffs (expires_at);
