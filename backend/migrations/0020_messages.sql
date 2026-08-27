CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id),
    sender_user_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    client_message_id TEXT NOT NULL,
    server_message_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    created_at TEXT NOT NULL,
    read_at TEXT,
    deleted_at TEXT,
    UNIQUE (match_id, sender_user_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_match_order
    ON messages (match_id, server_message_id);
