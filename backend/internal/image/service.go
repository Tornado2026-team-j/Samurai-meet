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
)

const (
	DefaultMaxUploadBytes = 20 * 1024 * 1024
	PhotoAlgorithm        = "AES-256-GCM"
)

var (
	ErrPhotoNotFound = errors.New("photo not found")
	ErrInvalidPhoto  = errors.New("invalid encrypted photo")
	ErrPhotoTooLarge = errors.New("encrypted photo is too large")
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
	wrappingAlgorithm := input.WrappingAlgorithm
	if wrappingAlgorithm == "" {
		wrappingAlgorithm = "KEY-A-AES-GCM"
	}
	if input.Visibility == "profile" {
		wrappingAlgorithm += "+RSA-OAEP-256:" + s.profileKeyVersion
	}
	var photo Photo
	var createdAt string
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO photos (id,owner_user_id,visibility,storage_path,cipher_sha256,nonce,algorithm,key_version,wrapped_image_key,wrapping_algorithm,created_at,content_type,size_bytes,server_wrapped_image_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id,visibility,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,wrapped_image_key,COALESCE(server_wrapped_image_key,''),wrapping_algorithm,created_at`,
		photoID, userID, input.Visibility, storagePath, cipherHash, input.Nonce, input.Algorithm, input.KeyVersion,
		input.WrappedImageKey, wrappingAlgorithm, created, input.ContentType, counted.count, nullableString(input.ServerWrappedKey),
	).Scan(&photo.ID, &photo.Visibility, &photo.ContentType, &photo.SizeBytes, &photo.CipherSHA256, &photo.Nonce, &photo.Algorithm, &photo.KeyVersion, &photo.WrappedImageKey, &photo.ServerWrappedKey, &photo.WrappingAlgorithm, &createdAt)
	if err != nil {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, err
	}
	photo.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		_ = s.store.DeleteCiphertext(userID, photoID)
		return Photo{}, err
	}
	photo.storagePath = storagePath
	return photo, nil
}

func (s *Service) GetCiphertext(ctx context.Context, userID, photoID string) (Photo, []byte, error) {
	photo, err := s.loadOwnedPhoto(ctx, userID, photoID)
	if err != nil {
		return Photo{}, nil, err
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
		SELECT p.id,p.owner_user_id,p.visibility,p.content_type,p.size_bytes,p.cipher_sha256,p.nonce,p.algorithm,p.key_version,p.wrapped_image_key,COALESCE(p.server_wrapped_image_key,''),p.wrapping_algorithm,p.created_at,p.storage_path
		FROM photos p JOIN users u ON u.id=p.owner_user_id
		WHERE p.id=$1 AND p.visibility='profile' AND p.deleted_at IS NULL AND u.status='active'`, photoID).
		Scan(&photo.ID, &photo.ownerID, &photo.Visibility, &photo.ContentType, &photo.SizeBytes, &photo.CipherSHA256, &photo.Nonce, &photo.Algorithm, &photo.KeyVersion, &photo.WrappedImageKey, &photo.ServerWrappedKey, &photo.WrappingAlgorithm, &createdAt, &photo.storagePath)
	if errors.Is(err, sql.ErrNoRows) {
		return Photo{}, nil, ErrPhotoNotFound
	}
	if err != nil {
		return Photo{}, nil, err
	}
	if !isSupportedContentType(photo.ContentType) {
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

// DeleteUserFiles is called by the account-deletion transaction before child
// rows are removed. If this fails, the account transaction must be rolled back.
func (s *Service) DeleteUserFiles(userID string) error {
	if err := s.store.DeleteUserCiphertext(userID); err != nil {
		return err
	}
	if s.cache != nil {
		s.cache.InvalidatePrefix("photo:" + userID + ":")
	}
	return nil
}

func (s *Service) loadOwnedPhoto(ctx context.Context, userID, photoID string) (Photo, error) {
	var photo Photo
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id,visibility,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,wrapped_image_key,COALESCE(server_wrapped_image_key,''),wrapping_algorithm,created_at,storage_path
		FROM photos WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, photoID, userID).
		Scan(&photo.ID, &photo.Visibility, &photo.ContentType, &photo.SizeBytes, &photo.CipherSHA256, &photo.Nonce, &photo.Algorithm, &photo.KeyVersion, &photo.WrappedImageKey, &photo.ServerWrappedKey, &photo.WrappingAlgorithm, &createdAt, &photo.storagePath)
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
	if input.Algorithm != PhotoAlgorithm || !safeComponent.MatchString(input.KeyVersion) {
		return ErrInvalidPhoto
	}
	if !validImageNonce(input.Nonce) || !validOpaqueKey(input.WrappedImageKey) {
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
	if profilePrivateKey == nil || !validOpaqueKey(input.ServerWrappedKey) {
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

func validOpaqueKey(value string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) >= 16
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
