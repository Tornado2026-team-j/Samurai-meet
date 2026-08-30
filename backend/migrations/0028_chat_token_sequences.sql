-- Monotonic Chat Token generation counter per (session, chat). Each
-- POST /chats/{id}/transport-token bumps seq, and the issued Chat Token carries
-- that value as token_seq. A live WebSocket connection tracks the highest
-- token_seq it has accepted and rejects an in-connection rotation to an older
-- generation, so a captured earlier Chat Token cannot be replayed to extend a
-- connection.
CREATE TABLE IF NOT EXISTS chat_token_sequences (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL DEFAULT 0 CHECK (seq >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, chat_id)
);
