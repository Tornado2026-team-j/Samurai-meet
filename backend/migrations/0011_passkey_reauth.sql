-- The migration runner executes one semicolon-delimited statement at a time.
-- The initial migration always creates this constraint, so a procedural DO
-- block is unnecessary and would be split incorrectly by the runner.
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_type_check;

ALTER TABLE auth_challenges
    ADD CONSTRAINT auth_challenges_type_check
    CHECK (type IN ('pre_auth', 'passkey_register', 'passkey_login', 'passkey_reauth'));