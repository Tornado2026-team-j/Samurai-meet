CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN (
        'new_application',
        'match_confirmed',
        'application_rejected',
        'new_message',
        'application_withdrawn',
        'guide_canceled',
        'guide_updated',
        'guide_reminder',
        'recruitment_expired'
    )),
    target_id TEXT NOT NULL,
    recruitment_id TEXT,
    destination TEXT NOT NULL CHECK (destination IN (
        'applicants',
        'application_detail',
        'guide_detail',
        'chat',
        'recruitment_detail'
    )),
    actor_name TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, read_at, created_at DESC);
