-- E2EE-safe report triage metadata. This migration deliberately stores no chat
-- plaintext, encryption keys, locations, access tokens, or provider responses.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE reports
    ADD CONSTRAINT reports_status_check
    CHECK (status IN ('received', 'triaged', 'escalated', 'reviewing', 'actioned', 'dismissed'));

DROP INDEX IF EXISTS idx_reports_open_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_open_dedupe
    ON reports (reporter_user_id, target_type, target_id)
    WHERE status IN ('received', 'triaged', 'escalated', 'reviewing');

CREATE TABLE IF NOT EXISTS report_triage (
    report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'unavailable', 'failed')),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('none', 'low', 'medium', 'high')),
    risk_kind TEXT NOT NULL CHECK (risk_kind IN ('none', 'harassment', 'violence', 'illicit', 'sexual_exploitation', 'scam', 'coercion', 'self_harm', 'other')),
    provider_mask TEXT NOT NULL DEFAULT '',
    provider_versions TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_triage_queue
    ON report_triage (state, risk_level, updated_at DESC);

-- Future evidence submission may use an application-managed encrypted envelope.
-- The current API deliberately has no endpoint for this table: a client must
-- explicitly consent and the review-key boundary must exist before it is wired.
CREATE TABLE IF NOT EXISTS report_evidence (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    key_reference TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_evidence_expiry
    ON report_evidence (expires_at) WHERE deleted_at IS NULL;
