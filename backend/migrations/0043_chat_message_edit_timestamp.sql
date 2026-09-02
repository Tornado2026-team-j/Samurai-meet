-- Keep the original creation time while recording whether the encrypted text
-- was replaced by its sender. The source plaintext is never stored here.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS edited_at TEXT;
