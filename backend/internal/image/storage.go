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
		temporary.Close()
		return "", "", err
	}
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(temporary, hash), ciphertext); err != nil {
		temporary.Close()
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

// DeleteUserCiphertext irreversibly removes every encrypted image owned by a
// deleted account. Callers must invalidate any ciphertext cache first.
func (s *Store) DeleteUserCiphertext(userID string) error {
	if !safeComponent.MatchString(userID) {
		return fmt.Errorf("invalid user ID")
	}
	return os.RemoveAll(filepath.Join(s.root, userID))
}
