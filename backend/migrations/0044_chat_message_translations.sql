-- Translation results are attached to a message revision and stored as
-- ciphertext. The server can reuse the cache without learning the translated
-- text or the detected source language.
CREATE TABLE IF NOT EXISTS chat_message_translations (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    target_language TEXT NOT NULL
        CHECK (target_language IN ('ja', 'en')),
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    algorithm TEXT NOT NULL
        CHECK (algorithm IN ('AES-256-GCM')),
    key_version TEXT NOT NULL,
    message_revision TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (message_id, target_language)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_translations_revision
    ON chat_message_translations (message_id, message_revision);
