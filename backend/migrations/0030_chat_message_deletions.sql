-- Append-only audit trail for chat message deletions. A retention sweep
-- tombstones a message by setting messages.deleted_at and clearing the
-- ciphertext and nonce, then records one row here. reason is 'retention' today
-- and leaves room for moderation or user-request deletions later.
CREATE TABLE IF NOT EXISTS chat_message_deletions (
    id BIGSERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    sequence BIGINT NOT NULL,
    sender_user_id TEXT NOT NULL,
    message_created_at TEXT NOT NULL,
    reason TEXT NOT NULL
        CHECK (reason IN ('retention', 'moderation', 'user_request')),
    retention_days INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_message_deletions_deleted_at
    ON chat_message_deletions (deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_deletions_chat
    ON chat_message_deletions (chat_id, sequence);
