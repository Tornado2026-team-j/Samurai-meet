ALTER TABLE passkey_bootstraps
    ADD COLUMN IF NOT EXISTS ceremony_token_hash TEXT UNIQUE;
