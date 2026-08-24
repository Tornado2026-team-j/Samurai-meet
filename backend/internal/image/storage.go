package image

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

// Store persists ciphertext only. It never accepts or writes image plaintext.
type Store struct{ root string }

var safeComponent = regexp.MustCompile(`\A[a-zA-Z0-9_-]{1,128}\z`)

func NewStore(root string) (*Store, error) {
	if root == "" {
		return nil, fmt.Errorf("image storage directory is required")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

func (s *Store) SaveCiphertext(userID, photoID string, ciphertext io.Reader) (path, cipherSHA256 string, err error) {
	if !safeComponent.MatchString(userID) || !safeComponent.MatchString(photoID) {
		return "", "", fmt.Errorf("user ID and photo ID are required")
	}
	directory := filepath.Join(s.root, userID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", "", err
	}
	path = filepath.Join(directory, photoID+".bin")
	temporary, err := os.CreateTemp(directory, ".upload-*")
	if err != nil {
		return "", "", err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		if closeErr := temporary.Close(); closeErr != nil {
			return "", "", fmt.Errorf("set temporary file permissions: %w (close failed: %v)", err, closeErr)
		}
		return "", "", err
	}
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(temporary, hash), ciphertext); err != nil {
		if closeErr := temporary.Close(); closeErr != nil {
			return "", "", fmt.Errorf("write ciphertext: %w (close failed: %v)", err, closeErr)
		}
		return "", "", err
	}
	if err := temporary.Close(); err != nil {
		return "", "", err
	}
	if err := os.Rename(temporaryName, path); err != nil {
		return "", "", err
	}
	return path, hex.EncodeToString(hash.Sum(nil)), nil
}

// ReadCiphertext reads one encrypted object and rejects files larger than the
// configured limit. The returned bytes are still ciphertext.
func (s *Store) ReadCiphertext(userID, photoID string, maxBytes int64) ([]byte, error) {
	if !safeComponent.MatchString(userID) || !safeComponent.MatchString(photoID) {
		return nil, fmt.Errorf("user ID and photo ID are required")
	}
	if maxBytes <= 0 {
		return nil, fmt.Errorf("maximum image size must be positive")
	}
	file, err := os.Open(s.ciphertextPath(userID, photoID))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > maxBytes {
		return nil, fmt.Errorf("ciphertext exceeds maximum image size")
	}
	return io.ReadAll(io.LimitReader(file, maxBytes+1))
}

// DeleteCiphertext removes one encrypted object. Missing files are treated as
// already deleted so account cleanup remains idempotent.
func (s *Store) DeleteCiphertext(userID, photoID string) error {
	if !safeComponent.MatchString(userID) || !safeComponent.MatchString(photoID) {
		return fmt.Errorf("user ID and photo ID are required")
	}
	err := os.Remove(s.ciphertextPath(userID, photoID))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// DeleteUserCiphertext irreversibly removes every encrypted image owned by a
// deleted account. Callers must invalidate any ciphertext cache first.
func (s *Store) DeleteUserCiphertext(userID string) error {
	if !safeComponent.MatchString(userID) {
		return fmt.Errorf("invalid user ID")
	}
	return os.RemoveAll(filepath.Join(s.root, userID))
}

func (s *Store) ciphertextPath(userID, photoID string) string {
	return filepath.Join(s.root, userID, photoID+".bin")
}
