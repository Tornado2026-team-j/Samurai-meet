ALTER TABLE oauth_handoffs ADD COLUMN IF NOT EXISTS response_ciphertext TEXT;
ALTER TABLE oauth_handoffs ADD COLUMN IF NOT EXISTS response_nonce TEXT;
