CREATE TABLE IF NOT EXISTS push_devices (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    chat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    match_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user
    ON push_devices (user_id, updated_at DESC);
