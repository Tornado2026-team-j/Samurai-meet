package chat

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/accountscope"
)

const (
	DemoDeviceKeyVersion = "demo-keyb-v1"
	DemoChatKeyVersion   = "demo-chat-v1"
	DemoChatAlgorithm    = "AES-256-GCM"
)

var (
	ErrDemoKeyForbidden = errors.New("demo key is available only to demo accounts")
	ErrDemoKeyInvalid   = errors.New("invalid demo device key")
	ErrDemoKeyConflict  = errors.New("demo device key already belongs to another device")
	ErrDemoKeyNotFound  = errors.New("demo peer key not found")
)

type DemoDeviceKeyInput struct {
	KeyVersion string `json:"key_version"`
	PublicKey  string `json:"public_key"`
}

type DemoDeviceKey struct {
	UserID     string `json:"user_id"`
	KeyVersion string `json:"key_version"`
	PublicKey  string `json:"public_key"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

type DemoPeerKey struct {
	UserID     string `json:"user_id"`
	KeyVersion string `json:"key_version"`
	PublicKey  string `json:"public_key"`
}

// RegisterDemoDeviceKey stores the one public agreement key used by a review
// account. It is idempotent for the same key and fail-closed for replacement;
// the client has no endpoint that can silently rotate the peer identity.
func (s *Service) RegisterDemoDeviceKey(ctx context.Context, userID string, input DemoDeviceKeyInput, now time.Time) (DemoDeviceKey, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return DemoDeviceKey{}, ErrDemoKeyForbidden
	}
	scope, err := accountscope.Resolve(ctx, s.db, userID, now)
	if err != nil {
		if isDemoScopeError(err) {
			return DemoDeviceKey{}, ErrDemoKeyForbidden
		}
		return DemoDeviceKey{}, err
	}
	if scope.AccountType != accountscope.Demo {
		return DemoDeviceKey{}, ErrDemoKeyForbidden
	}
	if input.KeyVersion != DemoDeviceKeyVersion || !validDemoPublicKey(input.PublicKey) {
		return DemoDeviceKey{}, ErrDemoKeyInvalid
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO demo_device_keys (user_id,key_version,public_key,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$4)
		ON CONFLICT (user_id) DO NOTHING`, userID, input.KeyVersion, input.PublicKey, stamp)
	if err != nil {
		return DemoDeviceKey{}, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr == nil && affected == 0 {
		var storedVersion, storedPublicKey, createdAt, updatedAt string
		if err = s.db.QueryRowContext(ctx, `
			SELECT key_version,public_key,created_at,updated_at
			FROM demo_device_keys WHERE user_id=$1`, userID).Scan(&storedVersion, &storedPublicKey, &createdAt, &updatedAt); err != nil {
			return DemoDeviceKey{}, err
		}
		if storedVersion != input.KeyVersion || storedPublicKey != input.PublicKey {
			return DemoDeviceKey{}, ErrDemoKeyConflict
		}
		return DemoDeviceKey{UserID: userID, KeyVersion: storedVersion, PublicKey: storedPublicKey, CreatedAt: createdAt, UpdatedAt: updatedAt}, nil
	}
	return DemoDeviceKey{UserID: userID, KeyVersion: input.KeyVersion, PublicKey: input.PublicKey, CreatedAt: stamp, UpdatedAt: stamp}, nil
}

// GetDemoPeerKey authorizes the chat before looking up the peer row. A direct
// cross-scope request therefore looks like a missing chat/key to the caller.
func (s *Service) GetDemoPeerKey(ctx context.Context, userID, chatID string, now time.Time) (DemoPeerKey, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(chatID) == "" {
		return DemoPeerKey{}, ErrChatNotFound
	}
	var ownerID, requesterID, status string
	err := s.db.QueryRowContext(ctx, `
		SELECT m.owner_user_id,m.requester_user_id,m.status
		FROM chat_threads c JOIN matches m ON m.id=c.match_id
		WHERE c.id=$1`, chatID).Scan(&ownerID, &requesterID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return DemoPeerKey{}, ErrChatNotFound
	}
	if err != nil {
		return DemoPeerKey{}, err
	}
	if userID != ownerID && userID != requesterID {
		return DemoPeerKey{}, ErrChatNotFound
	}
	if status != "accepted" && status != "completed" {
		return DemoPeerKey{}, ErrChatNotAvailable
	}
	scope, err := accountscope.RequireCompatible(ctx, s.db, ownerID, requesterID, now)
	if err != nil {
		if isDemoScopeError(err) {
			return DemoPeerKey{}, ErrChatNotFound
		}
		return DemoPeerKey{}, err
	}
	if scope.AccountType != accountscope.Demo {
		return DemoPeerKey{}, ErrDemoKeyForbidden
	}
	blocked, err := s.blocked(ctx, ownerID, requesterID)
	if err != nil {
		return DemoPeerKey{}, err
	}
	if blocked {
		return DemoPeerKey{}, ErrChatBlocked
	}
	peerID := ownerID
	if userID == ownerID {
		peerID = requesterID
	}
	var key DemoPeerKey
	err = s.db.QueryRowContext(ctx, `
		SELECT user_id,key_version,public_key
		FROM demo_device_keys WHERE user_id=$1`, peerID).Scan(&key.UserID, &key.KeyVersion, &key.PublicKey)
	if errors.Is(err, sql.ErrNoRows) {
		return DemoPeerKey{}, ErrDemoKeyNotFound
	}
	if err != nil {
		return DemoPeerKey{}, err
	}
	if key.KeyVersion != DemoDeviceKeyVersion || !validDemoPublicKey(key.PublicKey) {
		return DemoPeerKey{}, ErrDemoKeyNotFound
	}
	return key, nil
}

func validDemoPublicKey(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == 32 && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func isDemoScopeError(err error) bool {
	return errors.Is(err, accountscope.ErrUserNotFound) || errors.Is(err, accountscope.ErrInactive) ||
		errors.Is(err, accountscope.ErrExpired) || errors.Is(err, accountscope.ErrMismatch) || errors.Is(err, accountscope.ErrInvalid)
}
