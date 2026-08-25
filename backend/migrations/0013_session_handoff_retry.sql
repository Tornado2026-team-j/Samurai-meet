ALTER TABLE session_handoffs
    ADD COLUMN IF NOT EXISTS exchange_request_id TEXT;
