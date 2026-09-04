ALTER TABLE users
    ADD COLUMN account_type TEXT NOT NULL DEFAULT 'regular';

ALTER TABLE users
    ADD COLUMN demo_expires_at TEXT;

ALTER TABLE users
    ADD CONSTRAINT users_account_type_check
    CHECK (account_type IN ('regular', 'demo'));

ALTER TABLE users
    ADD CONSTRAINT users_demo_expiry_check
    CHECK (
        (account_type = 'regular' AND demo_expires_at IS NULL)
        OR (account_type = 'demo' AND demo_expires_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_users_demo_expiry
    ON users (account_type, demo_expires_at);
