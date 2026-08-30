CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL
        CHECK (target_type IN ('user', 'recruitment_card', 'message', 'photo')),
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL
        CHECK (reason IN ('nuisance', 'harassment', 'impersonation', 'inappropriate_photo', 'dangerous', 'other')),
    comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'reviewing', 'actioned', 'dismissed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (target_type <> 'user' OR target_id <> reporter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_queue
    ON reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_reporter
    ON reports (reporter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_target
    ON reports (target_type, target_id, created_at DESC);

-- One open report per reporter and target. A repeat submission returns the
-- existing row instead of stacking duplicates in the moderation queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_open_dedupe
    ON reports (reporter_user_id, target_type, target_id)
    WHERE status IN ('received', 'reviewing');
