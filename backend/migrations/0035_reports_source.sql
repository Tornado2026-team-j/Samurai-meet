-- Distinguish operator-review items created by the AI chat-content check from
-- reports a user filed by hand. Existing rows and hand reports stay 'user'.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user'
    CHECK (source IN ('user', 'ai_auto'));

CREATE INDEX IF NOT EXISTS idx_reports_source_queue
    ON reports (source, status, created_at DESC);
