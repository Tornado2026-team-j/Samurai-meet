-- Review demo accounts use a separate, short-lived device-key table. The
-- normal devices/key_b_materials tables are intentionally not reused: a demo
-- client must never enter the production Key-B/device-proof protocol.
CREATE TABLE IF NOT EXISTS demo_device_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    key_version TEXT NOT NULL CHECK (key_version = 'demo-keyb-v1'),
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
