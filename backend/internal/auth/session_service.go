package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var ErrRefreshReuse = errors.New("refresh token reuse detected")

type SessionTokens struct {
	UserID       string `json:"user_id"`
	SessionID    string `json:"session_id"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}
type SessionService struct {
	db     *sql.DB
	signer *Signer
	store  *SessionStore
}

type SessionSummary struct {
	ID         string    `json:"id"`
	DeviceName string    `json:"device_name,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	Current    bool      `json:"current"`
}

func NewSessionService(database *sql.DB, signer *Signer) *SessionService {
	return &SessionService{database, signer, NewSessionStore(database)}
}

func (s *SessionService) Authenticate(ctx context.Context, accessToken string, now time.Time) (AccessClaims, error) {
	if s == nil || s.db == nil || s.signer == nil || strings.TrimSpace(accessToken) == "" {
		return AccessClaims{}, errors.New("session signer is not configured")
	}
	claims, err := s.signer.Verify(accessToken, now)
	if err != nil {
		return AccessClaims{}, err
	}
	var status, expires, lastSeen string
	if err = s.db.QueryRowContext(ctx, `SELECT status,expires_at,last_seen_at FROM sessions WHERE id=$1 AND user_id=$2`, claims.SessionID, claims.Subject).Scan(&status, &expires, &lastSeen); err != nil {
		return AccessClaims{}, err
	}
	expiry, err := time.Parse(time.RFC3339Nano, expires)
	lastSeenAt, lastSeenErr := time.Parse(time.RFC3339Nano, lastSeen)
	if err != nil || lastSeenErr != nil || status != string(SessionActive) || !now.Before(expiry) || !now.Before(lastSeenAt.Add(RefreshIdleTTL)) {
		return AccessClaims{}, errors.New("session is inactive")
	}
	if _, err = s.db.ExecContext(ctx, `UPDATE sessions SET last_seen_at=$1 WHERE id=$2`, now.UTC().Format(time.RFC3339Nano), claims.SessionID); err != nil {
		return AccessClaims{}, err
	}
	return claims, nil
}

func (s *SessionService) CreateSession(ctx context.Context, userID string, now time.Time) (SessionTokens, error) {
	if s.signer == nil {
		return SessionTokens{}, errors.New("session signer is not configured")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionTokens{}, err
	}
	defer tx.Rollback()
	result, err := s.createSessionTx(ctx, tx, userID, now, false)
	if err != nil {
		return SessionTokens{}, err
	}
	if err = tx.Commit(); err != nil {
		return SessionTokens{}, err
	}
	return result, nil
}

// createSessionTx creates a regular session while the caller's transaction is
// open. Passkey-authenticated sessions are marked so a browser-to-app handoff
// cannot be created from an old, non-passkey session.
func (s *SessionService) createSessionTx(ctx context.Context, tx *sql.Tx, userID string, now time.Time, passkeyAuthenticated bool) (SessionTokens, error) {
	if s.signer == nil {
		return SessionTokens{}, errors.New("session signer is not configured")
	}
	sessionID, familyID, refreshID := newID(), newID(), newID()
	refresh, err := NewRefreshToken()
	if err != nil {
		return SessionTokens{}, err
	}
	hash, err := HashRefreshToken(refresh)
	if err != nil {
		return SessionTokens{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	expires := now.Add(RefreshAbsoluteTTL).UTC().Format(time.RFC3339Nano)
	var lastPasskeyAt any
	if passkeyAuthenticated {
		lastPasskeyAt = created
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO sessions (id,user_id,family_id,status,created_at,last_seen_at,expires_at,last_passkey_at) VALUES ($1,$2,$3,'active',$4,$4,$5,$6)`, sessionID, userID, familyID, created, expires, lastPasskeyAt); err != nil {
		return SessionTokens{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO refresh_tokens (id,session_id,token_hash,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5)`, refreshID, sessionID, hash, created, expires); err != nil {
		return SessionTokens{}, err
	}
	access, _, err := s.signer.Issue(userID, sessionID, newID(), now)
	if err != nil {
		return SessionTokens{}, err
	}
	return SessionTokens{UserID: userID, SessionID: sessionID, AccessToken: access, RefreshToken: refresh}, nil
}

// HasRecentPasskey is used only for privileged handoffs that transfer a
// freshly authenticated browser session to another client.
func (s *SessionService) HasRecentPasskey(ctx context.Context, userID, sessionID string, now time.Time) (bool, error) {
	var lastPasskey sql.NullString
	if err := s.db.QueryRowContext(ctx, `SELECT last_passkey_at FROM sessions WHERE id=$1 AND user_id=$2 AND status='active'`, sessionID, userID).Scan(&lastPasskey); err != nil {
		return false, err
	}
	if !lastPasskey.Valid || lastPasskey.String == "" {
		return false, nil
	}
	last, err := time.Parse(time.RFC3339Nano, lastPasskey.String)
	return err == nil && now.Before(last.Add(RecentPasskeyAuthTTL)), err
}

func (s *SessionService) ListForUser(ctx context.Context, userID, currentSessionID string) ([]SessionSummary, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,COALESCE(device_name,''),created_at,last_seen_at,expires_at FROM sessions WHERE user_id=$1 AND status='active' AND revoked_at IS NULL AND expires_at>$2 ORDER BY last_seen_at DESC`, userID, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]SessionSummary, 0)
	for rows.Next() {
		var item SessionSummary
		var created, lastSeen, expires string
		if err = rows.Scan(&item.ID, &item.DeviceName, &created, &lastSeen, &expires); err != nil {
			return nil, err
		}
		item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		item.LastSeenAt, err = time.Parse(time.RFC3339Nano, lastSeen)
		if err != nil {
			return nil, err
		}
		item.ExpiresAt, err = time.Parse(time.RFC3339Nano, expires)
		if err != nil {
			return nil, err
		}
		item.Current = item.ID == currentSessionID
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *SessionService) RevokeOwnedSession(ctx context.Context, userID, sessionID, reason string, now time.Time) error {
	result, err := s.db.ExecContext(ctx, `UPDATE sessions SET status='revoked',revoked_at=$1,revoked_reason=$2 WHERE id=$3 AND user_id=$4 AND revoked_at IS NULL`, now.UTC().Format(time.RFC3339Nano), reason, sessionID, userID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	_, err = s.db.ExecContext(ctx, `UPDATE refresh_tokens SET revoked_at=$1 WHERE session_id=$2 AND revoked_at IS NULL`, now.UTC().Format(time.RFC3339Nano), sessionID)
	return err
}

func (s *SessionService) RevokeAll(ctx context.Context, userID, reason string, now time.Time) error {
	return s.store.RevokeAllForUser(ctx, userID, reason, now)
}

func (s *SessionService) Refresh(ctx context.Context, token, requestID string, now time.Time) (SessionTokens, error) {
	if s.signer == nil {
		return SessionTokens{}, errors.New("session signer is not configured")
	}
	if requestID == "" {
		return SessionTokens{}, errors.New("refresh request ID is required")
	}
	hash, err := HashRefreshToken(token)
	if err != nil {
		return SessionTokens{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionTokens{}, err
	}
	defer tx.Rollback()
	var sessionID, userID, status, expires, lastSeen string
	var used, revoked sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT s.id,s.user_id,s.status,s.expires_at,s.last_seen_at,rt.used_at,rt.revoked_at FROM refresh_tokens rt JOIN sessions s ON s.id=rt.session_id WHERE rt.token_hash=$1 FOR UPDATE`, hash).Scan(&sessionID, &userID, &status, &expires, &lastSeen, &used, &revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionTokens{}, errors.New("refresh token is invalid")
	}
	if err != nil {
		return SessionTokens{}, err
	}
	expiry, err := time.Parse(time.RFC3339Nano, expires)
	lastSeenAt, lastSeenErr := time.Parse(time.RFC3339Nano, lastSeen)
	if err != nil || lastSeenErr != nil || !now.Before(expiry) || !now.Before(lastSeenAt.Add(RefreshIdleTTL)) || status != "active" || revoked.Valid {
		return SessionTokens{}, errors.New("session is inactive")
	}
	if used.Valid {
		var cipherText, nonce string
		var attemptExpiry string
		err = tx.QueryRowContext(ctx, `SELECT response_ciphertext,response_nonce,expires_at FROM refresh_attempts WHERE session_id=$1 AND request_id=$2 AND old_token_hash=$3`, sessionID, requestID, hash).Scan(&cipherText, &nonce, &attemptExpiry)
		if err == nil {
			exp, _ := time.Parse(time.RFC3339Nano, attemptExpiry)
			if now.Before(exp) {
				plain, openErr := s.signer.Open(cipherText, nonce)
				if openErr != nil {
					return SessionTokens{}, openErr
				}
				var cached SessionTokens
				if err = json.Unmarshal(plain, &cached); err != nil {
					return SessionTokens{}, err
				}
				return cached, tx.Commit()
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE sessions SET status='revoked',revoked_at=$1,revoked_reason='refresh_reuse' WHERE id=$2`, now.UTC().Format(time.RFC3339Nano), sessionID); err != nil {
			return SessionTokens{}, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE refresh_tokens SET revoked_at=$1 WHERE session_id=$2 AND revoked_at IS NULL`, now.UTC().Format(time.RFC3339Nano), sessionID); err != nil {
			return SessionTokens{}, err
		}
		if err = tx.Commit(); err != nil {
			return SessionTokens{}, err
		}
		return SessionTokens{}, ErrRefreshReuse
	}
	newRefresh, err := NewRefreshToken()
	if err != nil {
		return SessionTokens{}, err
	}
	newHash, err := HashRefreshToken(newRefresh)
	if err != nil {
		return SessionTokens{}, err
	}
	access, _, err := s.signer.Issue(userID, sessionID, newID(), now)
	if err != nil {
		return SessionTokens{}, err
	}
	result := SessionTokens{userID, sessionID, access, newRefresh}
	payload, err := json.Marshal(result) // #nosec G117 -- immediately encrypted for bounded retry storage; never logged or returned as JSON
	if err != nil {
		return SessionTokens{}, err
	}
	cipherText, nonce, err := s.signer.Seal(payload)
	if err != nil {
		return SessionTokens{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	retryExpiry := now.Add(RefreshRetryWindow).UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `UPDATE refresh_tokens SET used_at=$1 WHERE token_hash=$2`, created, hash); err != nil {
		return SessionTokens{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO refresh_tokens (id,session_id,token_hash,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5)`, newID(), sessionID, newHash, created, expiry.UTC().Format(time.RFC3339Nano)); err != nil {
		return SessionTokens{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO refresh_attempts (id,session_id,request_id,old_token_hash,response_ciphertext,response_nonce,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, newID(), sessionID, requestID, hash, cipherText, nonce, retryExpiry, created); err != nil {
		return SessionTokens{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE sessions SET last_seen_at=$1 WHERE id=$2`, created, sessionID); err != nil {
		return SessionTokens{}, err
	}
	if err = tx.Commit(); err != nil {
		return SessionTokens{}, err
	}
	return result, nil
}

func (s *SessionService) Logout(ctx context.Context, accessToken string, now time.Time) error {
	claims, err := s.Authenticate(ctx, accessToken, now)
	if err != nil {
		return err
	}
	return s.RevokeOwnedSession(ctx, claims.Subject, claims.SessionID, "logout", now)
}
