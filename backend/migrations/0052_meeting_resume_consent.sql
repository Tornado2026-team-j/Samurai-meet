-- A cancelled meeting can be resumed only after both participants explicitly
-- consent again. The request timestamps are cleared when the session returns
-- to planned, so starting the meeting still requires a fresh mutual start.
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS owner_resume_requested_at TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS requester_resume_requested_at TEXT;
