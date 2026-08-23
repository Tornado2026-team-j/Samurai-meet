CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    visibility TEXT NOT NULL CHECK (visibility IN ('private', 'profile')),
    storage_path TEXT NOT NULL UNIQUE,
    cipher_sha256 TEXT NOT NULL,
    nonce TEXT NOT NULL,
    algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
    key_version TEXT NOT NULL,
    wrapped_image_key TEXT NOT NULL,
    wrapping_algorithm TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_photos_owner_active
    ON photos (owner_user_id, deleted_at, created_at);
