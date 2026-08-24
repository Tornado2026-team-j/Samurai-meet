package keys

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrKeyBUnavailable = errors.New("key-b material is unavailable")
	ErrInvalidKeyBWrap = errors.New("key-b wrapping key is invalid")
)

// KeyBMaterial is returned only over an authenticated TLS response after a
// recent Passkey assertion. KeyB must stay in process memory only on clients.
type KeyBMaterial struct {
	KeyVersion string `json:"key_version"`
	KeyB       string `json:"key_b"`
}

type KeyBService struct {
	db        *sql.DB
	wrapKey   []byte
	wrapKeyID string
}

func NewKeyBService(database *sql.DB, encodedWrapKey, wrapKeyID string) (*KeyBService, error) {
	if database == nil || strings.TrimSpace(wrapKeyID) == "" || !keyVersionPattern.MatchString(wrapKeyID) {
		return nil, ErrInvalidKeyBWrap
	}
	key, err := base64.RawURLEncoding.DecodeString(encodedWrapKey)
	if err != nil || len(key) != 32 {
		return nil, ErrInvalidKeyBWrap
	}
	return &KeyBService{db: database, wrapKey: append([]byte(nil), key...), wrapKeyID: wrapKeyID}, nil
}

// GetOrCreate returns an ephemeral plaintext Key-B after decrypting it from
// PostgreSQL, or creates one. PostgreSQL stores only AES-GCM ciphertext.
func (s *KeyBService) GetOrCreate(ctx context.Context, userID string, now time.Time) (KeyBMaterial, error) {
	if s == nil || strings.TrimSpace(userID) == "" {
		return KeyBMaterial{}, ErrKeyBUnavailable
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return KeyBMaterial{}, err
	}
	defer tx.Rollback()

	var version, storedWrapID, ciphertext, nonce string
	err = tx.QueryRowContext(ctx, `SELECT key_version,wrap_key_id,ciphertext,nonce FROM key_b_materials WHERE user_id=$1 FOR UPDATE`, userID).Scan(&version, &storedWrapID, &ciphertext, &nonce)
	if err == nil {
		if storedWrapID != s.wrapKeyID {
			return KeyBMaterial{}, ErrKeyBUnavailable
		}
		raw, openErr := s.open(userID, version, ciphertext, nonce)
		if openErr != nil || len(raw) != 32 {
			return KeyBMaterial{}, ErrKeyBUnavailable
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return KeyBMaterial{}, commitErr
		}
		return KeyBMaterial{KeyVersion: version, KeyB: base64.RawURLEncoding.EncodeToString(raw)}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return KeyBMaterial{}, err
	}

	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return KeyBMaterial{}, err
	}
	version = "v1"
	ciphertext, nonce, err = s.seal(userID, version, raw)
	if err != nil {
		return KeyBMaterial{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `INSERT INTO key_b_materials (id,user_id,key_version,wrap_key_id,ciphertext,nonce,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`, newID(), userID, version, s.wrapKeyID, ciphertext, nonce, created); err != nil {
		return KeyBMaterial{}, err
	}
	if err = tx.Commit(); err != nil {
		return KeyBMaterial{}, err
	}
	return KeyBMaterial{KeyVersion: version, KeyB: base64.RawURLEncoding.EncodeToString(raw)}, nil
}

func (s *KeyBService) seal(userID, version string, plaintext []byte) (string, string, error) {
	block, err := aes.NewCipher(s.wrapKey)
	if err != nil {
		return "", "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", "", err
	}
	sealed := gcm.Seal(nil, nonce, plaintext, []byte(s.aad(userID, version)))
	return base64.RawURLEncoding.EncodeToString(sealed), base64.RawURLEncoding.EncodeToString(nonce), nil
}

func (s *KeyBService) open(userID, version, ciphertext, nonce string) ([]byte, error) {
	sealed, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, err
	}
	rawNonce, err := base64.RawURLEncoding.DecodeString(nonce)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(s.wrapKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, rawNonce, sealed, []byte(s.aad(userID, version)))
}

func (s *KeyBService) aad(userID, version string) string {
	return fmt.Sprintf("samurai-meet:key-b:%s:%s:%s", userID, version, s.wrapKeyID)
}
