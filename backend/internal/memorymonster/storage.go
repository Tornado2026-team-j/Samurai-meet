package memorymonster

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Store struct{ root string }

var safeComponent = regexp.MustCompile(`\A[a-zA-Z0-9_-]{1,128}\z`)

func NewStore(root string) (*Store, error) {
	if root == "" {
		return nil, fmt.Errorf("memory monster storage directory is required")
	}
	directory := filepath.Join(root, "memory-monsters")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	return &Store{root: directory}, nil
}

func (s *Store) Save(userID, monsterID, contentType string, body []byte) (string, error) {
	if !safeComponent.MatchString(userID) || !safeComponent.MatchString(monsterID) {
		return "", fmt.Errorf("user ID and monster ID are required")
	}
	if len(body) == 0 {
		return "", fmt.Errorf("generated image is empty")
	}
	extension := extensionForContentType(contentType)
	if extension == "" {
		return "", ErrInvalidInput
	}
	directory := filepath.Join(s.root, userID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	temporary, err := os.CreateTemp(directory, ".generated-*")
	if err != nil {
		return "", err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		if closeErr := temporary.Close(); closeErr != nil {
			return "", fmt.Errorf("set generated image permissions: %w (close failed: %v)", err, closeErr)
		}
		return "", err
	}
	if _, err := temporary.Write(body); err != nil {
		if closeErr := temporary.Close(); closeErr != nil {
			return "", fmt.Errorf("write generated image: %w (close failed: %v)", err, closeErr)
		}
		return "", err
	}
	if err := temporary.Close(); err != nil {
		return "", err
	}
	path := filepath.Join(directory, monsterID+extension)
	if err := os.Rename(temporaryName, path); err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join("memory-monsters", userID, monsterID+extension)), nil
}

func (s *Store) Read(storagePath string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, fmt.Errorf("maximum image size must be positive")
	}
	absolute, err := s.absolutePath(storagePath)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(absolute)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > maxBytes {
		return nil, fmt.Errorf("generated image exceeds maximum size")
	}
	return io.ReadAll(io.LimitReader(file, maxBytes+1))
}

func (s *Store) Delete(storagePath string) error {
	path, pathErr := s.absolutePath(storagePath)
	if pathErr != nil {
		return pathErr
	}
	err := os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func extensionForContentType(contentType string) string {
	switch contentType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

func isInside(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != "." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != ".." && !filepath.IsAbs(relative)
}

func (s *Store) absolutePath(storagePath string) (string, error) {
	path := filepath.Clean(storagePath)
	if !filepath.IsAbs(path) {
		path = filepath.Join(filepath.Dir(s.root), path)
	}
	root, err := filepath.Abs(s.root)
	if err != nil {
		return "", err
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !isInside(root, absolute) {
		return "", fmt.Errorf("invalid generated image path")
	}
	return absolute, nil
}
