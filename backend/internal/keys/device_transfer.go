package keys

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	DeviceTransferTTL             = 15 * time.Minute
	DeviceTransferMaxActive       = 3
	DeviceTransferMaxAttempts     = 5
	DeviceTransferCodeLength      = 8
	DeviceTransferEnvelopeMax     = 32 * 1024
	deviceTransferEnvelopeJSONMax = 4 * 1024
	DeviceTransferAlgorithm       = "X25519-HKDF-SHA256-AES-256-GCM"
	deviceTransferCodeAlphabet    = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

func validDeviceTransferCode(value string) bool {
	if len(value) != DeviceTransferCodeLength {
		return false
	}
	for _, character := range value {
		if !strings.ContainsRune(deviceTransferCodeAlphabet, character) {
			return false
		}
	}
	return true
}

var (
	ErrDeviceTransferNotFound         = errors.New("device transfer not found")
	ErrDeviceTransferRateLimited      = errors.New("device transfer rate limit exceeded")
	ErrDeviceTransferInvalidCode      = errors.New("device transfer verification code is invalid")
	ErrDeviceTransferCodeRateLimited  = errors.New("device transfer verification code rate limit exceeded")
	ErrDeviceTransferExpired          = errors.New("device transfer expired")
	ErrDeviceTransferNotPending       = errors.New("device transfer is not pending")
	ErrDeviceTransferNotApproved      = errors.New("device transfer is not approved")
	ErrDeviceTransferNotCancellable   = errors.New("device transfer is not cancellable")
	ErrDeviceTransferTargetMismatch   = errors.New("device transfer target does not match")
	ErrInvalidDeviceTransfer          = errors.New("invalid device transfer")
	ErrInvalidWrappedMasterKey        = errors.New("invalid wrapped master key")
	ErrDeviceTransferAgreementMissing = errors.New("target device agreement key is not registered")
)

// DeviceTransfer is public transfer metadata plus an opaque wrapped root key.
// The server deliberately does not have a field for a plaintext Master Key.
type DeviceTransfer struct {
	ID                         string     `json:"id"`
	SourceDeviceID             string     `json:"source_device_id,omitempty"`
	TargetDeviceID             string     `json:"target_device_id"`
	TargetKeyVersion           string     `json:"target_key_version"`
	TargetPublicKey            string     `json:"target_public_key"`
	TargetPublicKeyFingerprint string     `json:"target_public_key_fingerprint"`
	WrappedMasterKey           string     `json:"wrapped_master_key,omitempty"`
	WrappingAlgorithm          string     `json:"wrapping_algorithm,omitempty"`
	Status                     string     `json:"status"`
	ExpiresAt                  time.Time  `json:"expires_at"`
	CreatedAt                  time.Time  `json:"created_at"`
	ApprovedAt                 *time.Time `json:"approved_at,omitempty"`
	CompletedAt                *time.Time `json:"completed_at,omitempty"`
}

type DeviceTransferService struct {
	db *sql.DB
}

func NewDeviceTransferService(database *sql.DB) *DeviceTransferService {
	return &DeviceTransferService{db: database}
}

func (s *DeviceTransferService) Create(ctx context.Context, userID, targetDeviceID, targetKeyVersion, targetPublicKey, verificationCode string, now time.Time) (DeviceTransfer, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" ||
		!deviceIDPattern.MatchString(targetDeviceID) ||
		targetKeyVersion != DeviceAgreementKeyVersion ||
		!validX25519PublicKey(targetPublicKey) || !validDeviceTransferCode(verificationCode) {
		return DeviceTransfer{}, ErrInvalidDeviceTransfer
	}
	nowText := now.UTC().Format(time.RFC3339Nano)
	expiresAt := now.Add(DeviceTransferTTL).UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DeviceTransfer{}, err
	}
	defer tx.Rollback()
	// Serialize the active-transfer quota per account. Without this lock, two
	// simultaneous requests could both observe the old count and exceed it.
	var lockedUserID string
	if err = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, userID).Scan(&lockedUserID); err != nil {
		return DeviceTransfer{}, err
	}

	var agreementVersion, agreementPublicKey string
	err = tx.QueryRowContext(ctx, `
		SELECT COALESCE(agreement_key_version,''),COALESCE(agreement_public_key,'')
		FROM devices WHERE user_id=$1 AND device_id=$2 FOR SHARE`, userID, targetDeviceID).
		Scan(&agreementVersion, &agreementPublicKey)
	if errors.Is(err, sql.ErrNoRows) {
		return DeviceTransfer{}, ErrDeviceTransferNotFound
	}
	if err != nil {
		return DeviceTransfer{}, err
	}
	if agreementVersion == "" || agreementPublicKey == "" {
		return DeviceTransfer{}, ErrDeviceTransferAgreementMissing
	}
	if agreementVersion != targetKeyVersion || agreementPublicKey != targetPublicKey {
		return DeviceTransfer{}, ErrDeviceAgreementMismatch
	}

	var active int
	err = tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM device_key_transfers
		WHERE user_id=$1 AND status IN ('pending','approved') AND expires_at>$2`, userID, nowText).Scan(&active)
	if err != nil {
		return DeviceTransfer{}, err
	}
	if active >= DeviceTransferMaxActive {
		return DeviceTransfer{}, ErrDeviceTransferRateLimited
	}

	id := newID()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO device_key_transfers
		(id,user_id,target_device_id,target_key_version,target_public_key,target_public_key_fingerprint,verification_code_hash,expires_at,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, userID, targetDeviceID, targetKeyVersion, targetPublicKey,
		publicKeyFingerprint(targetPublicKey), verificationCodeHash(verificationCode),
		expiresAt.Format(time.RFC3339Nano), nowText)
	if err != nil {
		return DeviceTransfer{}, err
	}
	if err = tx.Commit(); err != nil {
		return DeviceTransfer{}, err
	}
	return DeviceTransfer{
		ID: id, TargetDeviceID: targetDeviceID, TargetKeyVersion: targetKeyVersion,
		TargetPublicKey: targetPublicKey, TargetPublicKeyFingerprint: publicKeyFingerprint(targetPublicKey),
		Status: "pending", ExpiresAt: expiresAt, CreatedAt: now.UTC(),
	}, nil
}

func (s *DeviceTransferService) List(ctx context.Context, userID string, now time.Time) ([]DeviceTransfer, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidDeviceTransfer
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE device_key_transfers SET status='expired'
		WHERE user_id=$1 AND status IN ('pending','approved') AND expires_at<=$2`, userID, now.UTC().Format(time.RFC3339Nano)); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,COALESCE(source_device_id,''),target_device_id,target_key_version,target_public_key,
			target_public_key_fingerprint,status,expires_at,created_at,approved_at,completed_at
		FROM device_key_transfers WHERE user_id=$1 AND status IN ('pending','approved')
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]DeviceTransfer, 0)
	for rows.Next() {
		item, err := scanDeviceTransfer(rows, false)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// GetForTarget returns the wrapped root only after the target device proof has
// already been verified by the HTTP boundary and the transfer is approved.
func (s *DeviceTransferService) GetForTarget(ctx context.Context, userID, transferID, targetDeviceID string, now time.Time) (DeviceTransfer, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(transferID) == "" || !deviceIDPattern.MatchString(targetDeviceID) {
		return DeviceTransfer{}, ErrInvalidDeviceTransfer
	}
	var item DeviceTransfer
	var sourceDeviceID, approvedAt, completedAt, wrappedMasterKey, wrappingAlgorithm string
	var expiresAt, createdAt string
	var attempts int
	err := s.db.QueryRowContext(ctx, `
		SELECT id,COALESCE(source_device_id,''),target_device_id,target_key_version,target_public_key,
			target_public_key_fingerprint,attempt_count,wrapped_master_key,wrapping_algorithm,status,
			expires_at,created_at,COALESCE(approved_at,''),COALESCE(completed_at,'')
		FROM device_key_transfers WHERE id=$1 AND user_id=$2`, transferID, userID).
		Scan(&item.ID, &sourceDeviceID, &item.TargetDeviceID, &item.TargetKeyVersion, &item.TargetPublicKey,
			&item.TargetPublicKeyFingerprint, &attempts, &wrappedMasterKey, &wrappingAlgorithm, &item.Status,
			&expiresAt, &createdAt, &approvedAt, &completedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return DeviceTransfer{}, ErrDeviceTransferNotFound
	}
	if err != nil {
		return DeviceTransfer{}, err
	}
	if item.TargetDeviceID != targetDeviceID {
		return DeviceTransfer{}, ErrDeviceTransferTargetMismatch
	}
	if item.TargetKeyVersion != DeviceAgreementKeyVersion || !validX25519PublicKey(item.TargetPublicKey) || item.TargetPublicKeyFingerprint != publicKeyFingerprint(item.TargetPublicKey) {
		return DeviceTransfer{}, ErrInvalidDeviceTransfer
	}
	item.SourceDeviceID = sourceDeviceID
	if err = parseTransferTimes(&item, expiresAt, createdAt, approvedAt, completedAt); err != nil {
		return DeviceTransfer{}, err
	}
	if (item.Status == "pending" || item.Status == "approved") && !now.Before(item.ExpiresAt) {
		if _, err = s.db.ExecContext(ctx, `UPDATE device_key_transfers SET status='expired' WHERE id=$1 AND user_id=$2 AND status IN ('pending','approved')`, transferID, userID); err != nil {
			return DeviceTransfer{}, err
		}
		item.Status = "expired"
	}
	if item.Status == "approved" {
		item.WrappedMasterKey = wrappedMasterKey
		item.WrappingAlgorithm = wrappingAlgorithm
		if err = validateWrappedMasterKey(item.WrappedMasterKey, item.ID, item.TargetDeviceID, item.TargetPublicKey); err != nil || item.WrappingAlgorithm != DeviceTransferAlgorithm {
			return DeviceTransfer{}, ErrInvalidWrappedMasterKey
		}
	}
	return item, nil
}

// Cancel revokes a transfer request from the target device that created it.
// It deliberately accepts only pending or approved transfers; the row lock
// makes cancellation race-safe with approval and completion.
func (s *DeviceTransferService) Cancel(ctx context.Context, userID, transferID, targetDeviceID string, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(transferID) == "" || !deviceIDPattern.MatchString(targetDeviceID) {
		return ErrInvalidDeviceTransfer
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var storedTarget, status, expiresAt string
	err = tx.QueryRowContext(ctx, `
		SELECT target_device_id,status,expires_at
		FROM device_key_transfers WHERE id=$1 AND user_id=$2 FOR UPDATE`, transferID, userID).
		Scan(&storedTarget, &status, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrDeviceTransferNotFound
	}
	if err != nil {
		return err
	}
	if storedTarget != targetDeviceID {
		return ErrDeviceTransferTargetMismatch
	}
	if status != "pending" && status != "approved" {
		return ErrDeviceTransferNotCancellable
	}
	expires, parseErr := time.Parse(time.RFC3339Nano, expiresAt)
	if parseErr != nil || !now.Before(expires) {
		if _, err = tx.ExecContext(ctx, `UPDATE device_key_transfers SET status='expired' WHERE id=$1 AND user_id=$2 AND status IN ('pending','approved')`, transferID, userID); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		return ErrDeviceTransferExpired
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE device_key_transfers
		SET status='cancelled',cancelled_at=$1,source_device_id=NULL,wrapped_master_key='',wrapping_algorithm=''
		WHERE id=$2 AND user_id=$3 AND target_device_id=$4 AND status IN ('pending','approved')`,
		now.UTC().Format(time.RFC3339Nano), transferID, userID, targetDeviceID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DeviceTransferService) Approve(ctx context.Context, userID, transferID, sourceDeviceID, verificationCode, wrappedMasterKey, wrappingAlgorithm string, now time.Time) (DeviceTransfer, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(transferID) == "" ||
		!deviceIDPattern.MatchString(sourceDeviceID) || !validDeviceTransferCode(verificationCode) ||
		wrappingAlgorithm != DeviceTransferAlgorithm || len(wrappedMasterKey) == 0 || len(wrappedMasterKey) > DeviceTransferEnvelopeMax {
		return DeviceTransfer{}, ErrInvalidDeviceTransfer
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DeviceTransfer{}, err
	}
	defer tx.Rollback()
	var targetDeviceID, targetKeyVersion, targetPublicKey, targetPublicKeyFingerprint, storedCodeHash, status, expiresAt string
	var attempts int
	err = tx.QueryRowContext(ctx, `
		SELECT target_device_id,target_key_version,target_public_key,target_public_key_fingerprint,verification_code_hash,status,attempt_count,expires_at
		FROM device_key_transfers WHERE id=$1 AND user_id=$2 FOR UPDATE`, transferID, userID).
		Scan(&targetDeviceID, &targetKeyVersion, &targetPublicKey, &targetPublicKeyFingerprint, &storedCodeHash, &status, &attempts, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return DeviceTransfer{}, ErrDeviceTransferNotFound
	}
	if err != nil {
		return DeviceTransfer{}, err
	}
	if targetKeyVersion != DeviceAgreementKeyVersion || !validX25519PublicKey(targetPublicKey) || targetPublicKeyFingerprint == "" || targetPublicKeyFingerprint != publicKeyFingerprint(targetPublicKey) {
		return DeviceTransfer{}, ErrInvalidDeviceTransfer
	}
	if sourceDeviceID == targetDeviceID {
		return DeviceTransfer{}, ErrDeviceTransferTargetMismatch
	}
	var sourceExists bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM devices WHERE user_id=$1 AND device_id=$2 AND key_version=$3)`, userID, sourceDeviceID, DeviceKeyVersion).Scan(&sourceExists); err != nil {
		return DeviceTransfer{}, err
	}
	if !sourceExists {
		return DeviceTransfer{}, ErrDeviceNotFound
	}
	expires, parseErr := time.Parse(time.RFC3339Nano, expiresAt)
	if parseErr != nil || !now.Before(expires) {
		_, _ = tx.ExecContext(ctx, `UPDATE device_key_transfers SET status='expired' WHERE id=$1 AND user_id=$2 AND status IN ('pending','approved')`, transferID, userID)
		if commitErr := tx.Commit(); commitErr != nil {
			return DeviceTransfer{}, commitErr
		}
		return DeviceTransfer{}, ErrDeviceTransferExpired
	}
	if status != "pending" {
		if status == "approved" || status == "completed" {
			return DeviceTransfer{}, ErrDeviceTransferNotPending
		}
		if status == "cancelled" {
			return DeviceTransfer{}, ErrDeviceTransferNotCancellable
		}
		return DeviceTransfer{}, ErrDeviceTransferExpired
	}
	if attempts >= DeviceTransferMaxAttempts {
		return DeviceTransfer{}, ErrDeviceTransferCodeRateLimited
	}
	if subtle.ConstantTimeCompare([]byte(storedCodeHash), []byte(verificationCodeHash(verificationCode))) != 1 {
		nextAttempts := attempts + 1
		nextStatus := status
		if nextAttempts >= DeviceTransferMaxAttempts {
			nextStatus = "rejected"
		}
		if _, err = tx.ExecContext(ctx, `UPDATE device_key_transfers SET attempt_count=$1,status=$2,rejected_at=CASE WHEN $2='rejected' THEN $3 ELSE rejected_at END WHERE id=$4 AND user_id=$5`, nextAttempts, nextStatus, now.UTC().Format(time.RFC3339Nano), transferID, userID); err != nil {
			return DeviceTransfer{}, err
		}
		if err = tx.Commit(); err != nil {
			return DeviceTransfer{}, err
		}
		if nextAttempts >= DeviceTransferMaxAttempts {
			return DeviceTransfer{}, ErrDeviceTransferCodeRateLimited
		}
		return DeviceTransfer{}, ErrDeviceTransferInvalidCode
	}
	if err = validateWrappedMasterKey(wrappedMasterKey, transferID, targetDeviceID, targetPublicKey); err != nil {
		return DeviceTransfer{}, err
	}
	approvedAt := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `
		UPDATE device_key_transfers
		SET source_device_id=$1,wrapped_master_key=$2,wrapping_algorithm=$3,status='approved',approved_at=$4
		WHERE id=$5 AND user_id=$6 AND status='pending'`, sourceDeviceID, wrappedMasterKey, wrappingAlgorithm, approvedAt, transferID, userID); err != nil {
		return DeviceTransfer{}, err
	}
	if err = tx.Commit(); err != nil {
		return DeviceTransfer{}, err
	}
	return s.GetForTarget(ctx, userID, transferID, targetDeviceID, now)
}

func (s *DeviceTransferService) Complete(ctx context.Context, userID, transferID, targetDeviceID string, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(transferID) == "" || !deviceIDPattern.MatchString(targetDeviceID) {
		return ErrInvalidDeviceTransfer
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var storedTarget, status, expiresAt string
	err = tx.QueryRowContext(ctx, `SELECT target_device_id,status,expires_at FROM device_key_transfers WHERE id=$1 AND user_id=$2 FOR UPDATE`, transferID, userID).Scan(&storedTarget, &status, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrDeviceTransferNotFound
	}
	if err != nil {
		return err
	}
	if storedTarget != targetDeviceID {
		return ErrDeviceTransferTargetMismatch
	}
	if status == "completed" {
		return nil
	}
	expires, parseErr := time.Parse(time.RFC3339Nano, expiresAt)
	if parseErr != nil || !now.Before(expires) {
		_, _ = tx.ExecContext(ctx, `UPDATE device_key_transfers SET status='expired' WHERE id=$1 AND user_id=$2 AND status='approved'`, transferID, userID)
		if commitErr := tx.Commit(); commitErr != nil {
			return commitErr
		}
		return ErrDeviceTransferExpired
	}
	if status != "approved" {
		return ErrDeviceTransferNotApproved
	}
	_, err = tx.ExecContext(ctx, `UPDATE device_key_transfers SET status='completed',completed_at=$1 WHERE id=$2 AND user_id=$3 AND status='approved'`, now.UTC().Format(time.RFC3339Nano), transferID, userID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

type wrappedMasterKeyEnvelope struct {
	Algorithm          string `json:"algorithm"`
	Version            int    `json:"version"`
	TransferID         string `json:"transfer_id"`
	TargetDeviceID     string `json:"target_device_id"`
	EphemeralPublicKey string `json:"ephemeral_public_key"`
	RecipientPublicKey string `json:"recipient_public_key"`
	Nonce              string `json:"nonce"`
	Ciphertext         string `json:"ciphertext"`
}

func validateWrappedMasterKey(encoded, transferID, targetDeviceID, targetPublicKey string) error {
	if len(encoded) == 0 || len(encoded) > DeviceTransferEnvelopeMax {
		return ErrInvalidWrappedMasterKey
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(raw) == 0 || len(raw) > deviceTransferEnvelopeJSONMax {
		return ErrInvalidWrappedMasterKey
	}
	var envelope wrappedMasterKeyEnvelope
	if err = json.Unmarshal(raw, &envelope); err != nil || envelope.Algorithm != DeviceTransferAlgorithm || envelope.Version != 1 || envelope.TransferID != transferID || envelope.TargetDeviceID != targetDeviceID || envelope.RecipientPublicKey != targetPublicKey || !validX25519PublicKey(envelope.EphemeralPublicKey) || !validX25519PublicKey(envelope.RecipientPublicKey) || !validExactBase64(envelope.Nonce, 12) {
		return ErrInvalidWrappedMasterKey
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(envelope.Ciphertext)
	if err != nil || len(ciphertext) != 32+16 {
		return ErrInvalidWrappedMasterKey
	}
	return nil
}

func validX25519PublicKey(value string) bool {
	return validExactBase64(value, 32)
}

func verificationCodeHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hexEncode(digest[:])
}

func publicKeyFingerprint(value string) string {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(raw)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func hexEncode(value []byte) string {
	const alphabet = "0123456789abcdef"
	result := make([]byte, len(value)*2)
	for index, item := range value {
		result[index*2] = alphabet[item>>4]
		result[index*2+1] = alphabet[item&15]
	}
	return string(result)
}

func scanDeviceTransfer(scanner interface{ Scan(...any) error }, includeEnvelope bool) (DeviceTransfer, error) {
	var item DeviceTransfer
	var sourceDeviceID, expiresAt, createdAt, approvedAt, completedAt string
	if includeEnvelope {
		if err := scanner.Scan(&item.ID, &sourceDeviceID, &item.TargetDeviceID, &item.TargetKeyVersion, &item.TargetPublicKey, &item.TargetPublicKeyFingerprint, &item.WrappedMasterKey, &item.WrappingAlgorithm, &item.Status, &expiresAt, &createdAt, &approvedAt, &completedAt); err != nil {
			return DeviceTransfer{}, err
		}
	} else {
		if err := scanner.Scan(&item.ID, &sourceDeviceID, &item.TargetDeviceID, &item.TargetKeyVersion, &item.TargetPublicKey, &item.TargetPublicKeyFingerprint, &item.Status, &expiresAt, &createdAt, &approvedAt, &completedAt); err != nil {
			return DeviceTransfer{}, err
		}
	}
	item.SourceDeviceID = sourceDeviceID
	if err := parseTransferTimes(&item, expiresAt, createdAt, approvedAt, completedAt); err != nil {
		return DeviceTransfer{}, err
	}
	return item, nil
}

func parseTransferTimes(item *DeviceTransfer, expiresAt, createdAt, approvedAt, completedAt string) error {
	var err error
	item.ExpiresAt, err = time.Parse(time.RFC3339Nano, expiresAt)
	if err != nil {
		return err
	}
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return err
	}
	if approvedAt != "" {
		value, parseErr := time.Parse(time.RFC3339Nano, approvedAt)
		if parseErr != nil {
			return parseErr
		}
		item.ApprovedAt = &value
	}
	if completedAt != "" {
		value, parseErr := time.Parse(time.RFC3339Nano, completedAt)
		if parseErr != nil {
			return parseErr
		}
		item.CompletedAt = &value
	}
	return nil
}
