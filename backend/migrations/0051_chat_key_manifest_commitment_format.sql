-- Restrict the 32-byte SHA-256 commitment to raw, unpadded Base64URL.
ALTER TABLE chat_key_manifests
    ADD CONSTRAINT chat_key_manifests_key_commitment_format_check
    CHECK (key_commitment ~ '^[A-Za-z0-9_-]{43}$');
