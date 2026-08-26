CREATE TABLE IF NOT EXISTS recruitment_cards (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    activity TEXT NOT NULL,
    location_label TEXT,
    available_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    duration_hours INTEGER NOT NULL CHECK (duration_hours > 0),
    distance_km INTEGER NOT NULL CHECK (distance_km IN (1, 3, 5)),
    status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'matched', 'closed', 'expired')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    recruitment_card_id TEXT NOT NULL REFERENCES recruitment_cards(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    interested_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked', 'expired', 'completed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (owner_user_id <> interested_user_id),
    UNIQUE (recruitment_card_id, interested_user_id)
);

CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    blocker_user_id TEXT NOT NULL REFERENCES users(id),
    blocked_user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    CHECK (blocker_user_id <> blocked_user_id),
    UNIQUE (blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_recruitment_cards_owner
    ON recruitment_cards (owner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_matches_owner
    ON matches (owner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_matches_interested
    ON matches (interested_user_id, status);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker
    ON blocks (blocker_user_id);
