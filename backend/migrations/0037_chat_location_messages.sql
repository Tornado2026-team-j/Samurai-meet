-- Location coordinates remain inside the existing ciphertext.  The server only
-- stores a typed envelope and an optional expiry so it can never inspect a
-- participant's exact meeting point.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text'
        CHECK (content_type IN ('text', 'location')),
    ADD COLUMN IF NOT EXISTS expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_location_expiry
    ON messages (expires_at)
    WHERE content_type = 'location' AND expires_at IS NOT NULL;
