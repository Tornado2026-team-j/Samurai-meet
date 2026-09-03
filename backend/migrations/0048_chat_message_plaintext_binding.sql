-- Store a salted commitment for client-decrypted message plaintext.
-- The salt and commitment are not sufficient to recover the plaintext.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS plaintext_commitment TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS plaintext_commitment_salt TEXT NOT NULL DEFAULT '';
