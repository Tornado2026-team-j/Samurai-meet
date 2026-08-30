-- Chat photo attachments. The server stores ciphertext blobs and opaque
-- crypto metadata only and never receives or derives the image key. Access is
-- limited to the participants of the attachment chat. Plaintext, EXIF, and
-- decrypted previews are never stored.
CREATE TABLE IF NOT EXISTS chat_attachments (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    uploader_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/octet-stream')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    cipher_sha256 TEXT NOT NULL,
    nonce TEXT NOT NULL,
    algorithm TEXT NOT NULL
        CHECK (algorithm IN ('AES-256-GCM')),
    key_version TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    linked_at TEXT,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_chat
    ON chat_attachments (chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
    ON chat_attachments (message_id);

-- Unreferenced uploads are swept after a grace period.
CREATE INDEX IF NOT EXISTS idx_chat_attachments_orphan
    ON chat_attachments (created_at)
    WHERE message_id IS NULL AND deleted_at IS NULL;
