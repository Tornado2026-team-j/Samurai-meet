package auth

import "time"

const (
	AccessTokenTTL       = time.Minute
	RefreshRetryWindow   = 30 * time.Second
	RefreshIdleTTL       = 30 * 24 * time.Hour
	RefreshAbsoluteTTL   = 90 * 24 * time.Hour
	PreAuthTokenTTL      = 5 * time.Minute
	RecentPasskeyAuthTTL = 5 * time.Minute
)

type SessionStatus string

const (
	SessionActive  SessionStatus = "active"
	SessionRevoked SessionStatus = "revoked"
	SessionExpired SessionStatus = "expired"
)

// Session is the application-level source of truth for JWT validity.
// A JWS must be rejected when the related session is revoked or expired.
type Session struct {
	ID        string
	UserID    string
	Status    SessionStatus
	ExpiresAt time.Time
	RevokedAt *time.Time
}

func (s Session) IsActiveAt(now time.Time) bool {
	return s.Status == SessionActive && s.RevokedAt == nil && now.Before(s.ExpiresAt)
}

// RefreshRequest is kept stable while the client retries the same refresh
// operation after an unknown network result.
type RefreshRequest struct {
	ID        string
	SessionID string
	CreatedAt time.Time
}

func (r RefreshRequest) IsRetryableAt(now time.Time) bool {
	return !r.CreatedAt.IsZero() && !now.After(r.CreatedAt.Add(RefreshRetryWindow))
}
