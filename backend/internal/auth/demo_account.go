package auth

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

const DemoAccountTTL = 24 * time.Hour

var ErrInvalidDemoAccountRequest = errors.New("invalid demo account request")

type DemoAccountService struct {
	db       *sql.DB
	sessions *SessionService
}

func NewDemoAccountService(database *sql.DB, sessions *SessionService) *DemoAccountService {
	return &DemoAccountService{db: database, sessions: sessions}
}

func (s *DemoAccountService) Start(ctx context.Context, language, appMode string, now time.Time) (SessionTokens, error) {
	if s == nil || s.db == nil || s.sessions == nil {
		return SessionTokens{}, errors.New("demo account service is not configured")
	}
	language = strings.TrimSpace(language)
	appMode = strings.TrimSpace(appMode)
	if (language != "ja" && language != "en") || (appMode != "local" && appMode != "traveler") {
		return SessionTokens{}, ErrInvalidDemoAccountRequest
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionTokens{}, err
	}
	defer tx.Rollback()

	userID := newID()
	created := now.UTC().Format(time.RFC3339Nano)
	expiresAt := now.Add(DemoAccountTTL).UTC()
	displayName := "Demo Judge"
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO users (id,google_subject_id,status,display_name,account_type,demo_expires_at,created_at,updated_at)
		VALUES ($1,$2,'active',$3,'demo',$4,$5,$5)`,
		userID,
		"demo:"+userID,
		displayName,
		expiresAt.Format(time.RFC3339Nano),
		created,
	); err != nil {
		return SessionTokens{}, err
	}

	tokens, err := s.sessions.createSessionWithExpiryTx(ctx, tx, userID, now, expiresAt, true)
	if err != nil {
		return SessionTokens{}, err
	}
	if err = tx.Commit(); err != nil {
		return SessionTokens{}, err
	}
	tokens.AccountType = "demo"
	tokens.DemoExpiresAt = &expiresAt
	return tokens, nil
}

// ExpiredUserIDs returns only demo users whose server-side deadline has passed.
// The caller owns deletion so it can reuse the same account cleanup path that
// removes encrypted files and non-cascading auth rows.
func (s *DemoAccountService) ExpiredUserIDs(ctx context.Context, limit int, now time.Time) ([]string, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id
		FROM users
		WHERE account_type='demo'
		  AND demo_expires_at IS NOT NULL
		  AND demo_expires_at::timestamptz <= $1::timestamptz
		ORDER BY demo_expires_at ASC
		LIMIT $2`, now.UTC().Format(time.RFC3339Nano), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
