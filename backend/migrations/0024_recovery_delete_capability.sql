ALTER TABLE pre_auth_tokens
    ADD COLUMN IF NOT EXISTS recovery_verified_at TEXT;
