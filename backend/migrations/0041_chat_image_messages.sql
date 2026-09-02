-- Chat image messages carry an encrypted marker in the existing messages
-- ciphertext and reference the ciphertext-only chat_attachments row.
-- Keep this as a follow-up migration so databases that already applied the
-- text/location contract receive the same constraint update safely.
ALTER TABLE messages
    DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
    ADD CONSTRAINT messages_content_type_check
        CHECK (content_type IN ('text', 'location', 'image'));
