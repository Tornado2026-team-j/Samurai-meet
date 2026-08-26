// Package keys stores encrypted client key envelopes.
package keys

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	ErrInvalidEnvelope  = errors.New("invalid key envelope")
	ErrEnvelopeNotFound = errors.New("key envelope not found")
	keyVersionPattern   = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
)

const (
	recoveryKDFAlgorithm = "HKDF-SHA256"
	recoveryInfo         = "samurai-meet/recovery-key/v1"
	recoverySaltBytes    = 16
	dataSaltBytes        = 16
)

// Envelope is the server representation of a client-owned Key-A envelope.
// EncryptedKeyA is opaque to the backend; the plaintext Key-A never crosses
// the API and is never written to PostgreSQL.
type Envelope struct {
	KeyVersion        string          `json:"key_version"`
	EncryptedKeyA     string          `json:"encrypted_key_a"`
	Nonce             string          `json:"nonce"`
	KDFParams         json.RawMessage `json:"kdf_params"`
	RecoveryPublicKey string          `json:"recovery_public_key,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

type Service struct{ db *sql.DB }

func NewService(database *sql.DB) *Service { return &Service{db: database} }

func (s *Service) Upsert(ctx context.Context, userID string, envelope Envelope, now time.Time) (Envelope, error) {
	if err := validate(userID, envelope); err != nil {
		return Envelope{}, err
	}
	created := now.UTC().Format(time.RFC3339Nano)
	var result Envelope
	var kdfParams, createdAt, updatedAt string
	var recoveryPublicKey sql.NullString
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO key_envelopes (id,user_id,encrypted_key_a,nonce,kdf_params,recovery_public_key,key_version,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
		ON CONFLICT (user_id,key_version) DO UPDATE SET
			encrypted_key_a=EXCLUDED.encrypted_key_a,
			nonce=EXCLUDED.nonce,
			kdf_params=EXCLUDED.kdf_params,
			recovery_public_key=EXCLUDED.recovery_public_key,
			updated_at=EXCLUDED.updated_at
		RETURNING encrypted_key_a,nonce,kdf_params,recovery_public_key,key_version,created_at,updated_at`,
		newID(), userID, envelope.EncryptedKeyA, envelope.Nonce, string(envelope.KDFParams), nullableString(envelope.RecoveryPublicKey), envelope.KeyVersion, created,
	).Scan(&result.EncryptedKeyA, &result.Nonce, &kdfParams, &recoveryPublicKey, &result.KeyVersion, &createdAt, &updatedAt)
	if err != nil {
		return Envelope{}, err
	}
	result.RecoveryPublicKey = recoveryPublicKey.String
	result.KDFParams = json.RawMessage(kdfParams)
	result.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Envelope{}, err
	}
	result.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return Envelope{}, err
	}
	return result, nil
}

func (s *Service) List(ctx context.Context, userID string) ([]Envelope, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidEnvelope
	}
	rows, err := s.db.QueryContext(ctx, `SELECT encrypted_key_a,nonce,kdf_params,recovery_public_key,key_version,created_at,updated_at FROM key_envelopes WHERE user_id=$1 ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Envelope, 0)
	for rows.Next() {
		item, err := scanEnvelope(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) Get(ctx context.Context, userID, version string) (Envelope, error) {
	if strings.TrimSpace(userID) == "" || !keyVersionPattern.MatchString(version) {
		return Envelope{}, ErrInvalidEnvelope
	}
	var result Envelope
	var kdfParams, createdAt, updatedAt string
	var recoveryPublicKey sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT encrypted_key_a,nonce,kdf_params,recovery_public_key,key_version,created_at,updated_at FROM key_envelopes WHERE user_id=$1 AND key_version=$2`, userID, version).
		Scan(&result.EncryptedKeyA, &result.Nonce, &kdfParams, &recoveryPublicKey, &result.KeyVersion, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Envelope{}, ErrEnvelopeNotFound
	}
	if err != nil {
		return Envelope{}, err
	}
	result.RecoveryPublicKey = recoveryPublicKey.String
	result.KDFParams = json.RawMessage(kdfParams)
	result.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Envelope{}, err
	}
	result.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return Envelope{}, err
	}
	return result, nil
}

func (s *Service) Delete(ctx context.Context, userID, version string) error {
	if strings.TrimSpace(userID) == "" || !keyVersionPattern.MatchString(version) {
		return ErrInvalidEnvelope
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM key_envelopes WHERE user_id=$1 AND key_version=$2`, userID, version)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrEnvelopeNotFound
	}
	return nil
}

func validate(userID string, envelope Envelope) error {
	if strings.TrimSpace(userID) == "" || !keyVersionPattern.MatchString(envelope.KeyVersion) {
		return ErrInvalidEnvelope
	}
	if !validBase64(envelope.EncryptedKeyA, 16) || !validBase64(envelope.Nonce, 12) {
		return ErrInvalidEnvelope
	}
	if len(envelope.KDFParams) == 0 || len(envelope.KDFParams) > 4096 || envelope.KDFParams[0] != '{' || !json.Valid(envelope.KDFParams) {
		return ErrInvalidEnvelope
	}
	if envelope.RecoveryPublicKey != "" {
		if !validExactBase64(envelope.RecoveryPublicKey, 32) || !validRecoveryKDFParams(envelope.KDFParams) {
			return ErrInvalidEnvelope
		}
	}
	return nil
}

func validBase64(value string, minBytes int) bool {
	if value == "" {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return false
	}
	return len(raw) >= minBytes
}

func validExactBase64(value string, bytes int) bool {
	if value == "" {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == bytes
}

type recoveryKDFParams struct {
	Algorithm string `json:"algorithm"`
	Salt      string `json:"salt"`
	Info      string `json:"info"`
	DataSalt  string `json:"data_salt"`
}

func validRecoveryKDFParams(raw json.RawMessage) bool {
	var params recoveryKDFParams
	if err := json.Unmarshal(raw, &params); err != nil || params.Algorithm != recoveryKDFAlgorithm || params.Info == "" {
		return false
	}
	info, err := base64.RawURLEncoding.DecodeString(params.Info)
	if err != nil || string(info) != recoveryInfo || !validExactBase64(params.Salt, recoverySaltBytes) {
		return false
	}
	return validExactBase64(params.DataSalt, dataSaltBytes)
}

func scanEnvelope(scanner interface{ Scan(...any) error }) (Envelope, error) {
	var item Envelope
	var kdfParams, createdAt, updatedAt string
	var recoveryPublicKey sql.NullString
	if err := scanner.Scan(&item.EncryptedKeyA, &item.Nonce, &kdfParams, &recoveryPublicKey, &item.KeyVersion, &createdAt, &updatedAt); err != nil {
		return Envelope{}, err
	}
	item.RecoveryPublicKey = recoveryPublicKey.String
	var err error
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Envelope{}, fmt.Errorf("parse key envelope created_at: %w", err)
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return Envelope{}, fmt.Errorf("parse key envelope updated_at: %w", err)
	}
	item.KDFParams = json.RawMessage(kdfParams)
	return item, nil
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func newID() string {
	raw := make([]byte, 16)
	if _, err := cryptoRandRead(raw); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// Indirection keeps the ID helper small and makes it straightforward to
// replace in tests without exposing randomness outside this package.
var cryptoRandRead = func(raw []byte) (int, error) {
	return rand.Read(raw)
}
