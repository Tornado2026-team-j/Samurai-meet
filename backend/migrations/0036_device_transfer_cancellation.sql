ALTER TABLE device_key_transfers
    DROP CONSTRAINT IF EXISTS device_key_transfers_status_check;

ALTER TABLE device_key_transfers
    ADD CONSTRAINT device_key_transfers_status_check
    CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'expired', 'cancelled'));

ALTER TABLE device_key_transfers
    ADD COLUMN IF NOT EXISTS cancelled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_device_key_transfers_cancelled
    ON device_key_transfers(user_id, target_device_id, status, cancelled_at);
