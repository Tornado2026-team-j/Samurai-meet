-- Store only client-created envelopes for the random per-chat content key.
-- The account envelope is wrapped by the stable client root-derived data key;
-- device envelopes are wrapped with the target device's X25519 agreement key.
-- Neither form contains a server-readable chat key.
CREATE TABLE IF NOT EXISTS chat_key_envelopes (
    chat_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('account', 'device')),
    device_id TEXT NOT NULL DEFAULT '',
    key_version TEXT NOT NULL,
    target_public_key TEXT NOT NULL DEFAULT '',
    wrapping_algorithm TEXT NOT NULL,
    envelope TEXT NOT NULL CHECK (length(envelope) BETWEEN 43 AND 16384),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (chat_id, user_id, scope, device_id),
    CHECK (
        (scope = 'account'
            AND device_id = ''
            AND key_version = 'chat-account-v1'
            AND target_public_key = ''
            AND wrapping_algorithm = 'AES-256-GCM')
        OR
        (scope = 'device'
            AND device_id <> ''
            AND key_version = 'x25519-v1'
            AND target_public_key <> ''
            AND wrapping_algorithm = 'X25519-HKDF-SHA256-AES-256-GCM')
    )
);

CREATE INDEX IF NOT EXISTS idx_chat_key_envelopes_device
    ON chat_key_envelopes (user_id, device_id, chat_id);
