package image

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const (
	DefaultMaxUploadBytes         = 20 * 1024 * 1024
	PhotoAlgorithm                = "AES-256-GCM"
	PhotoKeyVersion               = "v1"
	DeviceImageWrappingAlgorithm  = "KEY-B-AES-GCM"
	InitialImageWrappingAlgorithm = "KEY-A-AES-GCM+KEY-B-AES-GCM"
	wrappedImageKeyBytes          = 12 + 32 + 16
)

var (
	ErrPhotoNotFound       = errors.New("photo not found")
	ErrInvalidPhoto        = errors.New("invalid encrypted photo")
	ErrPhotoTooLarge       = errors.New("encrypted photo is too large")
	ErrDeviceNotRegistered = errors.New("device key is not registered")
)

// UploadInput contains metadata for an already encrypted image. Body must be
// AES-256-GCM ciphertext; plaintext is rejected by the API contract and is
// never written by Store.
type UploadInput struct {
	Visibility        string
	ContentType       string
	Nonce             string
	Algorithm         string
	KeyVersion        string
	WrappedImageKey   string
	AccountWrappedKey string
	DeviceID          string
	ServerWrappedKey  string
	WrappingAlgorithm string
	Body              io.Reader
}

type Photo struct {
	ID                string    `json:"id"`
	Visibility        string    `json:"visibility"`
	ContentType       string    `json:"content_type"`
	SizeBytes         int64     `json:"size_bytes"`
	CipherSHA256      string    `json:"cipher_sha256"`
	Nonce             string    `json:"nonce"`
	Algorithm         string    `json:"algorithm"`
	KeyVersion        string    `json:"key_version"`
	WrappedImageKey   string    `json:"wrapped_image_key"`
	AccountWrappedKey string    `json:"account_wrapped_image_key,omitempty"`
	ServerWrappedKey  string    `json:"server_wrapped_image_key,omitempty"`
	WrappingAlgorithm string    `json:"wrapping_algorithm"`
	CreatedAt         time.Time `json:"created_at"`
	ownerID           string
	storagePath       string
}

type Service struct {
	db                *sql.DB
	store             *Store
	cache             *CiphertextCache
	profilePrivateKey *rsa.PrivateKey
	profileKeyVersion string
	maxUploadBytes    int64
}

func NewService(database *sql.DB, store *Store, cache *CiphertextCache, profilePrivateKey *rsa.PrivateKey, profileKeyVersion string, maxUploadBytes int64) *Service {
	if maxUploadBytes <= 0 {
		maxUploadBytes = DefaultMaxUploadBytes
	}
	if strings.TrimSpace(profileKeyVersion) == "" {
		profileKeyVersion = "v1"
	}
	return &Service{
		db:                database,
		store:             store,
		cache:             cache,
		profilePrivateKey: profilePrivateKey,
		profileKeyVersion: profileKeyVersion,
		maxUploadBytes:    maxUploadBytes,
	}
}

func (s *Service) MaxUploadBytes() int64 { return s.maxUploadBytes }

func (s *Service) ProfilePublicKey() (PublicWrappingKey, error) {
	if s.profilePrivateKey == nil {
		return PublicWrappingKey{}, errors.New("profile wrapping key is not configured")
	}
	return PublicJWK(&s.profilePrivateKey.PublicKey), nil
}

func (s *Service) ProfileKeyVersion() string { return s.profileKeyVersion }

func (s *Service) Upload(ctx context.Context, userID string, input UploadInput, now time.Time) (Photo, error) {
	if input.ContentType == "" {
		input.ContentType = "application/octet-stream"
	}
	if err := validateUpload(input, s.profilePrivateKey); err != nil {
		return Photo{}, err
	}
	registered, err := s.deviceRegistered(ctx, userID, input.DeviceID)
	if err != nil {
		return Photo{}, err
	}
	if !registered {
		return Photo{}, ErrDeviceNotRegistered
	}
	photoID, err := newPhotoID()
	if err != nil {
		return Photo{}, err
	}
	if input.Body == nil {
		return Photo{}, ErrInvalidPhoto
	}
	counted := &countingReader{reader: io.LimitReader(input.Body, s.maxUploadBytes+1)}
	_, cipherHash, err := s.store.SaveCiphertext(userID, photoID, counted)
	if err != nil {
		return Photo{}, err
	}
	if counted.count > s.maxUploadBytes {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, ErrPhotoTooLarge
	}
	if counted.count < 16 {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, ErrInvalidPhoto
	}
	storagePath := filepath.ToSlash(filepath.Join(userID, photoID+".bin"))
	created := now.UTC().Format(time.RFC3339Nano)
	deviceWrappingAlgorithm := input.WrappingAlgorithm
	wrappingAlgorithm := deviceWrappingAlgorithm
	if input.Visibility == "profile" {
		wrappingAlgorithm += "+RSA-OAEP-256:" + s.profileKeyVersion
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, err
	}
	defer tx.Rollback()
	var photo Photo
	var createdAt string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO photos (id,owner_user_id,visibility,storage_path,cipher_sha256,nonce,algorithm,key_version,wrapped_image_key,account_wrapped_image_key,wrapping_algorithm,created_at,content_type,size_bytes,server_wrapped_image_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING id,visibility,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,wrapped_image_key,account_wrapped_image_key,COALESCE(server_wrapped_image_key,''),wrapping_algorithm,created_at`,
		photoID, userID, input.Visibility, storagePath, cipherHash, input.Nonce, input.Algorithm, input.KeyVersion,
		input.WrappedImageKey, input.AccountWrappedKey, wrappingAlgorithm, created, input.ContentType, counted.count, nullableString(input.ServerWrappedKey),
	).Scan(&photo.ID, &photo.Visibility, &photo.ContentType, &photo.SizeBytes, &photo.CipherSHA256, &photo.Nonce, &photo.Algorithm, &photo.KeyVersion, &photo.WrappedImageKey, &photo.AccountWrappedKey, &photo.ServerWrappedKey, &photo.WrappingAlgorithm, &createdAt)
	if err != nil {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, err
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO photo_device_key_envelopes (photo_id,user_id,device_id,key_version,wrapped_image_key,wrapping_algorithm,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
		photoID, userID, input.DeviceID, input.KeyVersion, input.WrappedImageKey, deviceWrappingAlgorithm, created,
	); err != nil {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, err
	}
	photo.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, err
	}
	if err = tx.Commit(); err != nil {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, err
	}
	photo.storagePath = storagePath
	return photo, nil
}

func (s *Service) GetCiphertext(ctx context.Context, userID, photoID, deviceID string) (Photo, []byte, error) {
	photo, err := s.loadOwnedPhoto(ctx, userID, photoID)
	if err != nil {
		return Photo{}, nil, err
	}
	if strings.TrimSpace(deviceID) != "" {
		registered, deviceErr := s.deviceRegistered(ctx, userID, deviceID)
		if deviceErr != nil {
			return Photo{}, nil, deviceErr
		}
		if !registered {
			return Photo{}, nil, ErrDeviceNotRegistered
		}
		var deviceWrapping, deviceKey string
		deviceErr = s.db.QueryRowContext(ctx, `
			SELECT wrapped_image_key,wrapping_algorithm
			FROM photo_device_key_envelopes
			WHERE photo_id=$1 AND user_id=$2 AND device_id=$3`, photoID, userID, deviceID).
			Scan(&deviceKey, &deviceWrapping)
		if errors.Is(deviceErr, sql.ErrNoRows) {
			photo.WrappedImageKey = ""
		} else if deviceErr != nil {
			return Photo{}, nil, deviceErr
		} else {
			photo.WrappedImageKey = deviceKey
			photo.WrappingAlgorithm = deviceWrapping
		}
	}
	cacheKey := "photo:" + userID + ":" + photoID
	if s.cache != nil {
		if data, ok := s.cache.Get(cacheKey, time.Now()); ok {
			return photo, data, nil
		}
	}
	data, err := s.store.ReadCiphertext(userID, photoID, s.maxUploadBytes+1)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Photo{}, nil, ErrPhotoNotFound
		}
		return Photo{}, nil, err
	}
	if hash := sha256.Sum256(data); hex.EncodeToString(hash[:]) != photo.CipherSHA256 {
		return Photo{}, nil, errors.New("encrypted photo hash mismatch")
	}
	if s.cache != nil {
		s.cache.Put(cacheKey, data, time.Now())
	}
	return photo, data, nil
}

// GetPublicProfileImage decrypts only a photo explicitly marked profile. The
// plaintext exists only for this response and is never put into the cache or
// database. Private photos always use GetCiphertext.
func (s *Service) GetPublicProfileImage(ctx context.Context, photoID string) (Photo, []byte, error) {
	if s.profilePrivateKey == nil {
		return Photo{}, nil, errors.New("profile wrapping key is not configured")
	}
	var photo Photo
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT p.id,p.owner_user_id,p.visibility,p.content_type,p.size_bytes,p.cipher_sha256,p.nonce,p.algorithm,p.key_version,p.wrapped_image_key,COALESCE(p.account_wrapped_image_key,''),COALESCE(p.server_wrapped_image_key,''),p.wrapping_algorithm,p.created_at,p.storage_path
		FROM photos p JOIN users u ON u.id=p.owner_user_id
		WHERE p.id=$1 AND p.visibility='profile' AND p.deleted_at IS NULL AND u.status='active'`, photoID).
		Scan(&photo.ID, &photo.ownerID, &photo.Visibility, &photo.ContentType, &photo.SizeBytes, &photo.CipherSHA256, &photo.Nonce, &photo.Algorithm, &photo.KeyVersion, &photo.WrappedImageKey, &photo.AccountWrappedKey, &photo.ServerWrappedKey, &photo.WrappingAlgorithm, &createdAt, &photo.storagePath)
	if errors.Is(err, sql.ErrNoRows) {
		return Photo{}, nil, ErrPhotoNotFound
	}
	if err != nil {
		return Photo{}, nil, err
	}
	if photo.KeyVersion != PhotoKeyVersion || photo.Algorithm != PhotoAlgorithm || photo.WrappingAlgorithm != InitialImageWrappingAlgorithm+"+RSA-OAEP-256:"+s.profileKeyVersion || !isSupportedContentType(photo.ContentType) {
		return Photo{}, nil, ErrInvalidPhoto
	}
	photo.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Photo{}, nil, err
	}
	ciphertext, err := s.store.ReadCiphertext(photo.ownerID, photoID, s.maxUploadBytes+1)
	if err != nil {
		return Photo{}, nil, err
	}
	if hash := sha256.Sum256(ciphertext); hex.EncodeToString(hash[:]) != photo.CipherSHA256 {
		return Photo{}, nil, errors.New("encrypted photo hash mismatch")
	}
	nonce, err := base64.RawURLEncoding.DecodeString(photo.Nonce)
	if err != nil {
		return Photo{}, nil, ErrInvalidPhoto
	}
	wrapped, err := base64.RawURLEncoding.DecodeString(photo.ServerWrappedKey)
	if err != nil {
		return Photo{}, nil, ErrInvalidPhoto
	}
	imageKey, err := UnwrapProfileImageKey(s.profilePrivateKey, wrapped)
	if err != nil || len(imageKey) != 32 {
		return Photo{}, nil, ErrInvalidPhoto
	}
	block, err := aes.NewCipher(imageKey)
	if err != nil {
		return Photo{}, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(nonce) != gcm.NonceSize() {
		return Photo{}, nil, ErrInvalidPhoto
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return Photo{}, nil, ErrInvalidPhoto
	}
	return photo, plaintext, nil
}

func (s *Service) DeletePhoto(ctx context.Context, userID, photoID string) error {
	if _, err := s.loadOwnedPhoto(ctx, userID, photoID); err != nil {
		return err
	}
	if err := s.store.DeleteCiphertext(userID, photoID); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM photos WHERE id=$1 AND owner_user_id=$2`, photoID, userID); err != nil {
		return err
	}
	s.invalidate(userID, photoID)
	return nil
}

type DeviceKeyEnvelopeInput struct {
	DeviceID          string
	KeyVersion        string
	WrappedImageKey   string
	WrappingAlgorithm string
}

func (s *Service) PutDeviceKeyEnvelope(ctx context.Context, userID, photoID string, input DeviceKeyEnvelopeInput, now time.Time) error {
	if !safeComponent.MatchString(input.DeviceID) || input.KeyVersion != PhotoKeyVersion || !validExactBase64(input.WrappedImageKey, wrappedImageKeyBytes) || input.WrappingAlgorithm != DeviceImageWrappingAlgorithm {
		return ErrInvalidPhoto
	}
	registered, err := s.deviceRegistered(ctx, userID, input.DeviceID)
	if err != nil {
		return err
	}
	if !registered {
		return ErrDeviceNotRegistered
	}
	photo, err := s.loadOwnedPhoto(ctx, userID, photoID)
	if err != nil {
		return err
	}
	if photo.KeyVersion != PhotoKeyVersion || !validExactBase64(photo.AccountWrappedKey, wrappedImageKeyBytes) {
		return ErrInvalidPhoto
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO photo_device_key_envelopes (photo_id,user_id,device_id,key_version,wrapped_image_key,wrapping_algorithm,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
		ON CONFLICT (photo_id,device_id) DO UPDATE SET
			key_version=EXCLUDED.key_version,
			wrapped_image_key=EXCLUDED.wrapped_image_key,
			wrapping_algorithm=EXCLUDED.wrapping_algorithm,
			updated_at=EXCLUDED.updated_at`,
		photoID, userID, input.DeviceID, input.KeyVersion, input.WrappedImageKey, input.WrappingAlgorithm, stamp,
	)
	return err
}

// DeleteUserFiles is idempotent and removes only ciphertext below the
// user-specific storage directory. Account deletion calls it after the
// database transaction commits; a durable cleanup job allows retrying it.
func (s *Service) DeleteUserFiles(userID string) error {
	if err := s.store.DeleteUserCiphertext(userID); err != nil {
		return err
	}
	if s.cache != nil {
		s.cache.InvalidatePrefix("photo:" + userID + ":")
	}
	return nil
}

// ProcessPendingUserFileCleanup retries durable account-deletion jobs. It is
// safe to call on every server startup because storage deletion is idempotent
// and a successfully cleaned job is removed only after the filesystem call
// succeeds.
func (s *Service) ProcessPendingUserFileCleanup(ctx context.Context, limit int, now time.Time) error {
	if s == nil || s.db == nil || s.store == nil {
		return nil
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT user_id FROM storage_cleanup_jobs ORDER BY created_at LIMIT $1`, limit)
	if err != nil {
		return err
	}
	userIDs := make([]string, 0, limit)
	for rows.Next() {
		var userID string
		if err = rows.Scan(&userID); err != nil {
			_ = rows.Close()
			return err
		}
		userIDs = append(userIDs, userID)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if err = rows.Err(); err != nil {
		return err
	}
	var firstErr error
	for _, userID := range userIDs {
		if cleanupErr := s.DeleteUserFiles(userID); cleanupErr != nil {
			_, _ = s.db.ExecContext(ctx, `UPDATE storage_cleanup_jobs SET attempts=attempts+1,last_error=$1,updated_at=$2 WHERE user_id=$3`, truncateImageCleanupError(cleanupErr), now.UTC().Format(time.RFC3339Nano), userID)
			if firstErr == nil {
				firstErr = cleanupErr
			}
			continue
		}
		if _, err = s.db.ExecContext(ctx, `DELETE FROM storage_cleanup_jobs WHERE user_id=$1`, userID); err != nil {
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func truncateImageCleanupError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 512 {
		return message[:512]
	}
	return message
}

func (s *Service) deviceRegistered(ctx context.Context, userID, deviceID string) (bool, error) {
	if !safeComponent.MatchString(deviceID) {
		return false, ErrDeviceNotRegistered
	}
	var registered bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM devices WHERE user_id=$1 AND device_id=$2 AND key_version=$3)`, userID, deviceID, keys.DeviceKeyVersion).Scan(&registered)
	return registered, err
}

func (s *Service) loadOwnedPhoto(ctx context.Context, userID, photoID string) (Photo, error) {
	var photo Photo
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id,visibility,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,wrapped_image_key,COALESCE(account_wrapped_image_key,''),COALESCE(server_wrapped_image_key,''),wrapping_algorithm,created_at,storage_path
		FROM photos WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, photoID, userID).
		Scan(&photo.ID, &photo.Visibility, &photo.ContentType, &photo.SizeBytes, &photo.CipherSHA256, &photo.Nonce, &photo.Algorithm, &photo.KeyVersion, &photo.WrappedImageKey, &photo.AccountWrappedKey, &photo.ServerWrappedKey, &photo.WrappingAlgorithm, &createdAt, &photo.storagePath)
	if errors.Is(err, sql.ErrNoRows) {
		return Photo{}, ErrPhotoNotFound
	}
	if err != nil {
		return Photo{}, err
	}
	photo.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Photo{}, err
	}
	return photo, nil
}

func (s *Service) invalidate(userID, photoID string) {
	if s.cache != nil {
		s.cache.InvalidatePrefix("photo:" + userID + ":" + photoID)
	}
}

func validateUpload(input UploadInput, profilePrivateKey *rsa.PrivateKey) error {
	if input.Visibility != "private" && input.Visibility != "profile" {
		return ErrInvalidPhoto
	}
	if input.Algorithm != PhotoAlgorithm || input.KeyVersion != PhotoKeyVersion || input.WrappingAlgorithm != InitialImageWrappingAlgorithm {
		return ErrInvalidPhoto
	}
	if !validImageNonce(input.Nonce) || !validExactBase64(input.WrappedImageKey, wrappedImageKeyBytes) || !validExactBase64(input.AccountWrappedKey, wrappedImageKeyBytes) || !safeComponent.MatchString(input.DeviceID) {
		return ErrInvalidPhoto
	}
	if input.ContentType == "" {
		input.ContentType = "application/octet-stream"
	}
	if len(input.ContentType) > 128 || strings.ContainsAny(input.ContentType, "\r\n") {
		return ErrInvalidPhoto
	}
	if !isSupportedContentType(input.ContentType) {
		return ErrInvalidPhoto
	}
	for _, r := range input.ContentType {
		if unicode.IsControl(r) {
			return ErrInvalidPhoto
		}
	}
	if input.Visibility == "private" {
		if input.ServerWrappedKey != "" {
			return ErrInvalidPhoto
		}
		return nil
	}
	if profilePrivateKey == nil || !validExactBase64(input.ServerWrappedKey, profilePrivateKey.Size()) {
		return ErrInvalidPhoto
	}
	wrapped, err := base64.RawURLEncoding.DecodeString(input.ServerWrappedKey)
	if err != nil {
		return ErrInvalidPhoto
	}
	imageKey, err := UnwrapProfileImageKey(profilePrivateKey, wrapped)
	if err != nil || len(imageKey) != 32 {
		return ErrInvalidPhoto
	}
	return nil
}

func isSupportedContentType(value string) bool {
	switch value {
	case "application/octet-stream", "image/jpeg", "image/png", "image/webp":
		return true
	default:
		// SVG and other browser-interpreted formats are intentionally rejected.
		return false
	}
}

func validImageNonce(value string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == 12
}

func validExactBase64(value string, expectedBytes int) bool {
	if value == "" || expectedBytes <= 0 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == expectedBytes
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func newPhotoID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

type countingReader struct {
	reader io.Reader
	count  int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.count += int64(n)
	return n, err
}
