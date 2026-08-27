-- Account deletion commits database removal before filesystem cleanup. This
-- table makes the ciphertext cleanup retryable after a transient filesystem
-- or container-volume failure and intentionally has no user foreign key: the
-- user row is already gone by the time the job is processed.
CREATE TABLE IF NOT EXISTS storage_cleanup_jobs (
    user_id TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_jobs_created
    ON storage_cleanup_jobs (created_at);
