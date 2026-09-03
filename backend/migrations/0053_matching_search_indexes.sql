-- Search checks accepted capacity per recruitment card. Keep this partial
-- index small because pending and terminal match rows are not part of the
-- capacity count.
CREATE INDEX IF NOT EXISTS idx_matches_accepted_card
    ON matches (card_id)
    WHERE status = 'accepted';
