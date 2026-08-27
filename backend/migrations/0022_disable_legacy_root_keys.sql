-- Pre-release cutover: the old HKDF/Base64URL Recovery Key envelope is not
-- migrated. Its rows are removed so the recovery endpoint cannot accidentally
-- select a legacy decryption path. Account ciphertext remains untouched, so a
-- user must complete v2 setup/recovery before encrypted data is usable again.
DELETE FROM recovery_challenges;
DELETE FROM key_envelopes WHERE key_version <> 'v2';

ALTER TABLE key_envelopes
    DROP CONSTRAINT IF EXISTS key_envelopes_v2_only;

ALTER TABLE key_envelopes
    ADD CONSTRAINT key_envelopes_v2_only CHECK (key_version = 'v2');

-- This table belonged to the retired server-wrapped Key-B experiment. Keep
-- the table for the account-deletion cleanup query, but remove any material
-- that may have been written by an old development build.
DELETE FROM key_b_materials;
