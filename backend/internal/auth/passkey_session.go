package auth

import (
	"context"
	"errors"
	"time"
)

// CreatePasskeySession creates a session whose recent-passkey marker is set
// atomically. Browser Web Passkey flows use this before a handoff and do not
// expose the returned access or refresh tokens to the browser page.
func (s *SessionService) CreatePasskeySession(ctx context.Context, userID string, now time.Time) (SessionTokens, error) {
	if s == nil || s.signer == nil || userID == "" {
		return SessionTokens{}, errors.New("session signer is not configured")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionTokens{}, err
	}
	defer tx.Rollback()
	result, err := s.createSessionTx(ctx, tx, userID, now, true)
	if err != nil {
		return SessionTokens{}, err
	}
	if err = tx.Commit(); err != nil {
		return SessionTokens{}, err
	}
	return result, nil
}
