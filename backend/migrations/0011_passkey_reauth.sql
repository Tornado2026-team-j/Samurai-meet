DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'auth_challenges'::regclass
          AND conname = 'auth_challenges_type_check'
    ) THEN
        ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_type_check;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'auth_challenges'::regclass
          AND conname = 'auth_challenges_type_check'
    ) THEN
        ALTER TABLE auth_challenges
            ADD CONSTRAINT auth_challenges_type_check
            CHECK (type IN ('pre_auth', 'passkey_register', 'passkey_login', 'passkey_reauth'));
    END IF;
END $$;
