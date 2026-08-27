ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS agreement_key_version TEXT,
    ADD COLUMN IF NOT EXISTS agreement_public_key TEXT;

CREATE TABLE IF NOT EXISTS device_key_transfers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_device_id TEXT,
    target_device_id TEXT NOT NULL,
    target_key_version TEXT NOT NULL,
    target_public_key TEXT NOT NULL,
    target_public_key_fingerprint TEXT NOT NULL,
    verification_code_hash TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
    wrapped_master_key TEXT NOT NULL DEFAULT '',
    wrapping_algorithm TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    approved_at TEXT,
    completed_at TEXT,
    rejected_at TEXT,
    FOREIGN KEY (user_id, target_device_id) REFERENCES devices(user_id, device_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, source_device_id) REFERENCES devices(user_id, device_id) ON DELETE CASCADE,
    CHECK (source_device_id IS NULL OR source_device_id <> target_device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_key_transfers_target
    ON device_key_transfers(user_id, target_device_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_device_key_transfers_pending
    ON device_key_transfers(user_id, status, expires_at);
