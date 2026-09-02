-- Compare in-flight expiry values as timestamps instead of text.
ALTER TABLE chat_translation_inflight
    ALTER COLUMN expires_at TYPE TIMESTAMPTZ
    USING expires_at::timestamptz;
