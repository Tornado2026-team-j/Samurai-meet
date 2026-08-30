UPDATE recruitment_cards
SET category = 'Heritage'
WHERE category = 'Places';

ALTER TABLE recruitment_cards
    DROP CONSTRAINT IF EXISTS recruitment_cards_category_check;

ALTER TABLE recruitment_cards
    ADD CONSTRAINT recruitment_cards_category_check
    CHECK (category IN ('Food', 'Heritage', 'Activity', 'Other'));

ALTER TABLE recruitment_cards
    ADD COLUMN IF NOT EXISTS participant_limit SMALLINT NOT NULL DEFAULT 1
        CHECK (participant_limit BETWEEN 1 AND 10);

ALTER TABLE recruitment_cards
    ADD COLUMN IF NOT EXISTS location_name TEXT NOT NULL DEFAULT ''
        CHECK (char_length(location_name) <= 120);
