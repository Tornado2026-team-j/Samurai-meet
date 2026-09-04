CREATE TABLE IF NOT EXISTS match_likes (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    liker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (match_id, liker_user_id),
    CHECK (liker_user_id <> liked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_match_likes_liked_user
    ON match_likes (liked_user_id, created_at DESC);
