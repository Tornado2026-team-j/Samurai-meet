-- Complete the 0040 compatibility migration. The legacy 0040 table used
-- (attachment_id, device_id), while the current envelope identity also needs
-- the recipient user_id. This is intentionally a forward migration so the
-- already-applied 0040 SQL and its immutable history are left untouched.
ALTER TABLE chat_attachment_key_envelopes
    DROP CONSTRAINT IF EXISTS chat_attachment_key_envelopes_pkey;

ALTER TABLE chat_attachment_key_envelopes
    ADD CONSTRAINT chat_attachment_key_envelopes_pkey
        PRIMARY KEY (attachment_id, user_id, device_id);
