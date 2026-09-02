-- Shared PostgreSQL state for account-scoped translation provider budgets.
-- No plaintext, provider response, or request body is stored in these tables.
CREATE TABLE IF NOT EXISTS chat_translation_rate_limits (
    scope_key TEXT PRIMARY KEY,
    tokens DOUBLE PRECISION NOT NULL CHECK (tokens >= 0),
    last_refill_unix DOUBLE PRECISION NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_translation_inflight (
    request_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_translation_inflight_user_expiry
    ON chat_translation_inflight (user_id, expires_at);
