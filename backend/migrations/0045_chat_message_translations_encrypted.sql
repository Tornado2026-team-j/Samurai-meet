-- Move the first translation-cache schema to the encrypted envelope shape.
-- The old cache stored plaintext and cannot be re-encrypted without Key-B.
ALTER TABLE chat_message_translations
    ADD COLUMN IF NOT EXISTS ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS nonce TEXT,
    ADD COLUMN IF NOT EXISTS algorithm TEXT,
    ADD COLUMN IF NOT EXISTS key_version TEXT;

-- Discard legacy plaintext rows and retain already-encrypted rows if this
-- forward migration is replayed against a partially migrated database.
DELETE FROM chat_message_translations
WHERE ciphertext IS NULL
   OR nonce IS NULL
   OR algorithm IS NULL
   OR key_version IS NULL;

ALTER TABLE chat_message_translations
    ALTER COLUMN ciphertext SET NOT NULL,
    ALTER COLUMN nonce SET NOT NULL,
    ALTER COLUMN algorithm SET NOT NULL,
    ALTER COLUMN key_version SET NOT NULL,
    DROP COLUMN IF EXISTS source_language,
    DROP COLUMN IF EXISTS translated_text;

ALTER TABLE chat_message_translations
    DROP CONSTRAINT IF EXISTS chat_message_translations_algorithm_check,
    ADD CONSTRAINT chat_message_translations_algorithm_check
        CHECK (algorithm IN ('AES-256-GCM'));

CREATE INDEX IF NOT EXISTS idx_chat_message_translations_revision
    ON chat_message_translations (message_id, message_revision);
