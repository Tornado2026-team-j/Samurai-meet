-- Meeting assistance is opt-in by both accepted-match participants.  No exact
-- location, BLE identifier, RSSI sample or persistent device identifier is kept.
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS owner_started_at TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS requester_started_at TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS cancelled_at TEXT;

ALTER TABLE meeting_proximity_latest DROP COLUMN IF EXISTS distance_m;
ALTER TABLE meeting_proximity_latest DROP COLUMN IF EXISTS confidence;
ALTER TABLE meeting_proximity_latest DROP COLUMN IF EXISTS sample_id;
ALTER TABLE meeting_proximity_latest ADD COLUMN IF NOT EXISTS distance_band TEXT NOT NULL DEFAULT 'unknown'
    CHECK (distance_band IN ('nearby','short_walk','far','unknown'));
