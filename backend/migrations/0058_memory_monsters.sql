CREATE TABLE IF NOT EXISTS memory_monsters (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    meeting_id TEXT REFERENCES meeting_sessions(id) ON DELETE SET NULL,
    source_photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
    memorable_object TEXT NOT NULL,
    memory_text TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    provider TEXT NOT NULL,
    generated_storage_path TEXT NOT NULL UNIQUE,
    generated_content_type TEXT NOT NULL
        CHECK (generated_content_type IN ('image/png', 'image/jpeg', 'image/webp')),
    created_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_monsters_owner_created
    ON memory_monsters (owner_user_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_monsters_match_owner
    ON memory_monsters (match_id, owner_user_id, created_at DESC);
