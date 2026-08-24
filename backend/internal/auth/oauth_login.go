package auth

import (
	"context"
	"database/sql"
	"time"
)

type OAuthLoginResult struct {
	UserID, AccessToken, RefreshToken, SessionID string
	IsNewUser                                    bool
}
type OAuthLoginService struct {
	google *GoogleOIDC
	states *OAuthStateStore
	db     *sql.DB
	signer *Signer
}

func NewOAuthLoginService(google *GoogleOIDC, states *OAuthStateStore, database *sql.DB, signer *Signer) *OAuthLoginService {
	return &OAuthLoginService{google, states, database, signer}
}
func (s *OAuthLoginService) Start(ctx context.Context, now time.Time) (string, error) {
	state, verifier, err := s.states.Create(ctx, now)
	if err != nil {
		return "", err
	}
	return s.google.AuthorizationURL(state, pkceChallenge(verifier)), nil
}
func (s *OAuthLoginService) Complete(ctx context.Context, code, state string, now time.Time) (OAuthLoginResult, error) {
	verifier, err := s.states.Consume(ctx, state, now)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	identity, err := s.google.Exchange(ctx, code, verifier)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	defer tx.Rollback()
	userID := newID()
	created := now.UTC().Format(time.RFC3339Nano)
	var actualID string
	err = tx.QueryRowContext(ctx, `INSERT INTO users (id,google_subject_id,status,created_at,updated_at) VALUES ($1,$2,'active',$3,$3) ON CONFLICT (google_subject_id) DO UPDATE SET updated_at=EXCLUDED.updated_at RETURNING id`, userID, identity.Subject, created).Scan(&actualID)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	sessionID, familyID, refreshID := newID(), newID(), newID()
	refresh, err := NewRefreshToken()
	if err != nil {
		return OAuthLoginResult{}, err
	}
	hash, err := HashRefreshToken(refresh)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	expires := now.Add(RefreshAbsoluteTTL).UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `INSERT INTO sessions (id,user_id,family_id,status,created_at,last_seen_at,expires_at) VALUES ($1,$2,$3,'active',$4,$4,$5)`, sessionID, actualID, familyID, created, expires); err != nil {
		return OAuthLoginResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO refresh_tokens (id,session_id,token_hash,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5)`, refreshID, sessionID, hash, created, expires); err != nil {
		return OAuthLoginResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return OAuthLoginResult{}, err
	}
	access, _, err := s.signer.Issue(actualID, sessionID, newID(), now)
	if err != nil {
		return OAuthLoginResult{}, err
	}
	return OAuthLoginResult{actualID, access, refresh, sessionID, actualID == userID}, nil
}
