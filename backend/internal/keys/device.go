package keys

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	ErrInvalidDevice      = errors.New("invalid device key registration")
	ErrDeviceNotFound     = errors.New("device key registration not found")
	ErrDeviceKeyMismatch  = errors.New("device public key does not match registration")
	ErrInvalidDeviceProof = errors.New("invalid device proof")
	ErrDeviceProofReplay  = errors.New("device proof was already used")
	deviceIDPattern       = regexp.MustCompile(`^[A-Za-z0-9._~-]{8,128}$`)
)

const (
	DeviceKeyVersion  = "v1"
	DeviceProofDomain = "samurai-meet:device-proof/v1"
	deviceProofMaxAge = 5 * time.Minute
)

// Device is public registration metadata only. The device's Key-B is generated
// and retained by the client Secure Storage; it never crosses this API.
type Device struct {
	DeviceID   string    `json:"device_id"`
	KeyVersion string    `json:"key_version"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
	publicKey  string
}

type DeviceService struct {
	db *sql.DB
}

func NewDeviceService(database *sql.DB) *DeviceService {
	return &DeviceService{db: database}
}

func (s *DeviceService) Register(ctx context.Context, userID, deviceID, keyVersion, publicKey string, now time.Time) (Device, error) {
	if s == nil || s.db == nil || !validDeviceRegistration(userID, deviceID, keyVersion, publicKey) {
		return Device{}, ErrInvalidDevice
	}
	nowText := now.UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Device{}, err
	}
	defer tx.Rollback()
	var device Device
	var createdAt, lastSeenAt string
	var storedPublicKey string
	err = tx.QueryRowContext(ctx, `SELECT public_key FROM devices WHERE user_id=$1 AND device_id=$2 FOR UPDATE`, userID, deviceID).Scan(&storedPublicKey)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(ctx, `
			INSERT INTO devices (id,user_id,device_id,key_version,public_key,created_at,last_seen_at)
			VALUES ($1,$2,$3,$4,$5,$6,$6)
			RETURNING device_id,key_version,created_at,last_seen_at`,
			newID(), userID, deviceID, keyVersion, publicKey, nowText,
		).Scan(&device.DeviceID, &device.KeyVersion, &createdAt, &lastSeenAt)
	} else if err == nil {
		if storedPublicKey != publicKey {
			return Device{}, ErrDeviceKeyMismatch
		}
		err = tx.QueryRowContext(ctx, `
			UPDATE devices SET key_version=$1,last_seen_at=$2
			WHERE user_id=$3 AND device_id=$4
			RETURNING device_id,key_version,created_at,last_seen_at`,
			keyVersion, nowText, userID, deviceID,
		).Scan(&device.DeviceID, &device.KeyVersion, &createdAt, &lastSeenAt)
	}
	if err != nil {
		return Device{}, err
	}
	device.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Device{}, err
	}
	device.LastSeenAt, err = time.Parse(time.RFC3339Nano, lastSeenAt)
	if err != nil {
		return Device{}, err
	}
	if err = tx.Commit(); err != nil {
		return Device{}, err
	}
	return device, nil
}

func (s *DeviceService) List(ctx context.Context, userID string) ([]Device, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidDevice
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT device_id,key_version,created_at,last_seen_at
		FROM devices WHERE user_id=$1 ORDER BY last_seen_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	devices := make([]Device, 0)
	for rows.Next() {
		var device Device
		var createdAt, lastSeenAt string
		if err := rows.Scan(&device.DeviceID, &device.KeyVersion, &createdAt, &lastSeenAt); err != nil {
			return nil, err
		}
		device.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
		if err != nil {
			return nil, err
		}
		device.LastSeenAt, err = time.Parse(time.RFC3339Nano, lastSeenAt)
		if err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (s *DeviceService) Exists(ctx context.Context, userID, deviceID string) (bool, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || !deviceIDPattern.MatchString(deviceID) {
		return false, ErrInvalidDevice
	}
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM devices WHERE user_id=$1 AND device_id=$2)`, userID, deviceID).Scan(&exists)
	return exists, err
}

// VerifyProof authenticates a request with the public key registered for the
// device. The nonce is persisted only long enough to reject replay.
func (s *DeviceService) VerifyProof(ctx context.Context, userID, deviceID, method, path, timestamp, nonce, bodyHash, signature string, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || !deviceIDPattern.MatchString(deviceID) || method == "" || len(path) == 0 || len(path) > 2048 {
		return ErrInvalidDeviceProof
	}
	parsedTime, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil || now.Sub(parsedTime) > deviceProofMaxAge || parsedTime.Sub(now) > deviceProofMaxAge {
		return ErrInvalidDeviceProof
	}
	nonceBytes, err := base64.RawURLEncoding.DecodeString(nonce)
	if err != nil || len(nonceBytes) != 16 {
		return ErrInvalidDeviceProof
	}
	bodyHashBytes, err := base64.RawURLEncoding.DecodeString(bodyHash)
	if err != nil || len(bodyHashBytes) != sha256Size {
		return ErrInvalidDeviceProof
	}
	signatureBytes, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || len(signatureBytes) != ed25519.SignatureSize {
		return ErrInvalidDeviceProof
	}
	var publicKeyEncoded string
	if err = s.db.QueryRowContext(ctx, `SELECT public_key FROM devices WHERE user_id=$1 AND device_id=$2`, userID, deviceID).Scan(&publicKeyEncoded); errors.Is(err, sql.ErrNoRows) {
		return ErrDeviceNotFound
	} else if err != nil {
		return err
	}
	publicKey, err := base64.RawURLEncoding.DecodeString(publicKeyEncoded)
	if err != nil || len(publicKey) != ed25519.PublicKeySize || !ed25519.Verify(ed25519.PublicKey(publicKey), deviceProofMessage(userID, deviceID, method, path, timestamp, nonce, bodyHash), signatureBytes) {
		return ErrInvalidDeviceProof
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, _ = tx.ExecContext(ctx, `DELETE FROM device_request_nonces WHERE expires_at < $1`, now.UTC().Format(time.RFC3339Nano))
	result, err := tx.ExecContext(ctx, `
		INSERT INTO device_request_nonces (user_id,device_id,nonce,expires_at)
		VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,device_id,nonce) DO NOTHING`,
		userID, deviceID, nonce, parsedTime.Add(deviceProofMaxAge).UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrDeviceProofReplay
	}
	return tx.Commit()
}

const sha256Size = 32

func deviceProofMessage(userID, deviceID, method, path, timestamp, nonce, bodyHash string) []byte {
	return []byte(fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s", DeviceProofDomain, userID, deviceID, method, path, timestamp, nonce, bodyHash))
}

func validDeviceRegistration(userID, deviceID, keyVersion, publicKey string) bool {
	if strings.TrimSpace(userID) == "" || !deviceIDPattern.MatchString(deviceID) || !keyVersionPattern.MatchString(keyVersion) {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(publicKey)
	return err == nil && len(raw) == ed25519.PublicKeySize
}
