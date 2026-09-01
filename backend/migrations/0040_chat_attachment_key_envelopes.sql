-- Per-device Key-B envelopes for chat attachments. The envelope payload is
-- opaque to the server: only the ciphertext, public metadata, and the
-- client-created envelope are retained. No private key or image plaintext is
-- accepted by this table or its API.
CREATE TABLE IF NOT EXISTS chat_attachment_key_envelopes (
    attachment_id TEXT NOT NULL REFERENCES chat_attachments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    target_key_version TEXT NOT NULL
        CHECK (target_key_version IN ('x25519-v1')),
    target_public_key TEXT NOT NULL,
    wrapping_algorithm TEXT NOT NULL
        CHECK (wrapping_algorithm IN ('X25519-HKDF-SHA256-AES-256-GCM')),
    envelope TEXT NOT NULL CHECK (length(envelope) BETWEEN 43 AND 16384),
    created_at TEXT NOT NULL,
    PRIMARY KEY (attachment_id, user_id, device_id),
    FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_attachment_key_envelopes_device
    ON chat_attachment_key_envelopes (user_id, device_id, attachment_id);
