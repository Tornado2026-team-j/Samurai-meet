-- Bind every immutable chat-key envelope to one client-verifiable DEK commitment.
-- The match owner is the only authority allowed to provision device envelopes;
-- the server stores no chat DEK and never opens an envelope.
CREATE TABLE IF NOT EXISTS chat_key_manifests (
    chat_id TEXT PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
    authority_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_commitment TEXT NOT NULL CHECK (length(key_commitment) = 43),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_key_manifests_authority
    ON chat_key_manifests (authority_user_id, chat_id);
