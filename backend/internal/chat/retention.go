package chat

import (
	"context"
	"time"
)

// defaultMessageRetentionDays is the age after which a message's ciphertext is
// tombstoned. It is configurable per deployment; the number itself is an
// operations/legal decision.
const defaultMessageRetentionDays = 180

// retentionPurgeBatch caps how many messages one PurgeExpiredMessages call
// tombstones, so a first run over a large backlog stays a bounded statement.
const retentionPurgeBatch = 2000

// ConfigureMessageRetention sets the retention window in days. A non-positive
// value leaves the current setting in place so a misconfiguration cannot
// silently disable retention.
func (s *Service) ConfigureMessageRetention(days int) {
	if s != nil && days > 0 {
		s.retentionDays = days
	}
}

// RetentionDays reports the active retention window.
func (s *Service) RetentionDays() int {
	if s == nil {
		return 0
	}
	return s.retentionDays
}

// PurgeExpiredMessages tombstones every message older than the retention
// window: it sets deleted_at, clears the ciphertext and nonce (the point of a
// retention policy is that the content is gone), and writes one
// chat_message_deletions audit row per message. Read paths already filter
// deleted_at IS NULL, so a tombstoned message disappears from history, unread
// counts, and cross-instance fan-out. It returns the number purged and is safe
// to run concurrently on multiple instances and to call repeatedly.
func (s *Service) PurgeExpiredMessages(ctx context.Context, now time.Time) (int, error) {
	if s == nil || s.db == nil || s.retentionDays <= 0 {
		return 0, nil
	}
	cutoff := now.UTC().Add(-time.Duration(s.retentionDays) * 24 * time.Hour).Format(time.RFC3339Nano)
	deletedAt := now.UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `
		WITH expired AS (
			SELECT id FROM messages
			WHERE deleted_at IS NULL AND created_at < $1
			ORDER BY sequence
			LIMIT $2
		),
		purged AS (
			UPDATE messages m SET deleted_at=$3, ciphertext='', nonce=''
			FROM expired e WHERE m.id=e.id
			RETURNING m.id, m.chat_id, m.sequence, m.sender_user_id, m.created_at
		)
		INSERT INTO chat_message_deletions
			(chat_id, message_id, sequence, sender_user_id, message_created_at, reason, retention_days, deleted_at)
		SELECT chat_id, id, sequence, sender_user_id, created_at, 'retention', $4, $3 FROM purged
		ON CONFLICT (message_id) DO NOTHING`,
		cutoff, retentionPurgeBatch, deletedAt, s.retentionDays)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(count), nil
}
