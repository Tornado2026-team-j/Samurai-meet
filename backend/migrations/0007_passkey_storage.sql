ALTER TABLE auth_challenges ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE passkey_credentials ADD COLUMN IF NOT EXISTS credential_json TEXT;

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user
    ON passkey_credentials (user_id, created_at);
