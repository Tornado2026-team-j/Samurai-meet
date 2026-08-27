CREATE TABLE IF NOT EXISTS chat_threads (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_updated
    ON chat_threads (updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id TEXT NOT NULL,
    sequence BIGSERIAL NOT NULL UNIQUE,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    algorithm TEXT NOT NULL
        CHECK (algorithm IN ('AES-256-GCM')),
    key_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (chat_id, sender_user_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_sequence
    ON messages (chat_id, sequence);

CREATE INDEX IF NOT EXISTS idx_messages_sender_created
    ON messages (sender_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_read_states (
    chat_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
    read_at TEXT NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS meeting_sessions (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    scheduled_at TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_sessions_status
    ON meeting_sessions (status, updated_at DESC);

-- Only the latest short-lived estimate for each participant and method is
-- retained. Raw BLE identifiers, RSSI samples, and location coordinates are
-- deliberately not accepted or stored.
CREATE TABLE IF NOT EXISTS meeting_proximity_latest (
    meeting_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL
        CHECK (method IN ('bluetooth_rssi', 'bluetooth_uwb', 'location_inference')),
    distance_m DOUBLE PRECISION NOT NULL CHECK (distance_m >= 0 AND distance_m <= 1000),
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    sample_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (meeting_id, user_id, method)
);

CREATE INDEX IF NOT EXISTS idx_meeting_proximity_expiry
    ON meeting_proximity_latest (captured_at);
