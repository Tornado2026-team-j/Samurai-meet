CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    nationality_code TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    icon_photo_id TEXT,
    identity_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (identity_status IN ('unverified', 'pending', 'verified', 'rejected', 'expired')),
    likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_identity_status
    ON profiles (identity_status, user_id);

CREATE TABLE IF NOT EXISTS user_locations (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    accuracy_m DOUBLE PRECISION NOT NULL CHECK (accuracy_m >= 0),
    captured_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_locations_expiry
    ON user_locations (expires_at);

CREATE TABLE IF NOT EXISTS recruitment_cards (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'Other'
        CHECK (category IN ('Food', 'Places', 'Activity', 'Other')),
    available_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    timezone TEXT NOT NULL,
    keywords_json TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    visibility_radius_km SMALLINT NOT NULL
        CHECK (visibility_radius_km IN (1, 3, 5)),
    latitude DOUBLE PRECISION CHECK (latitude >= -90 AND latitude <= 90),
    longitude DOUBLE PRECISION CHECK (longitude >= -180 AND longitude <= 180),
    location_accuracy_m DOUBLE PRECISION CHECK (location_accuracy_m IS NULL OR location_accuracy_m >= 0),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'open', 'matched', 'closed', 'expired', 'completed')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recruitment_cards_search
    ON recruitment_cards (status, available_date, expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_cards_owner
    ON recruitment_cards (owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS blocks (
    blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked_user
    ON blocks (blocked_user_id, blocker_user_id);

CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES recruitment_cards(id) ON DELETE CASCADE,
    requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked', 'expired', 'completed')),
    matched_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (card_id, requester_user_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_owner_status
    ON matches (owner_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_matches_requester_status
    ON matches (requester_user_id, status, updated_at DESC);
