-- Repair deployments which completed the short-lived Heritage category
-- migration.  The product's public category is Places.
ALTER TABLE recruitment_cards
    DROP CONSTRAINT IF EXISTS recruitment_cards_category_check;

UPDATE recruitment_cards
SET category = 'Places'
WHERE category = 'Heritage';

ALTER TABLE recruitment_cards
    ADD CONSTRAINT recruitment_cards_category_check
    CHECK (category IN ('Food', 'Places', 'Activity', 'Other'));
