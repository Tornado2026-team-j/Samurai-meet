ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS account_wrapped_image_key TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    key_version TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS photo_device_key_envelopes (
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    key_version TEXT NOT NULL,
    wrapped_image_key TEXT NOT NULL,
    wrapping_algorithm TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (photo_id, device_id),
    FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_device_key_envelopes_user_id
    ON photo_device_key_envelopes(user_id, device_id);

CREATE TABLE IF NOT EXISTS device_request_nonces (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (user_id, device_id, nonce),
    FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_request_nonces_expires_at
    ON device_request_nonces(expires_at);
