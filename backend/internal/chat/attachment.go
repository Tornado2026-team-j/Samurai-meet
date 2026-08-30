package chat

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
	"time"
)

const (
	attachmentAlgorithm       = "AES-256-GCM"
	attachmentMinCiphertext   = 16
	maxPendingAttachments     = 10
	attachmentSweepBatch      = 500
	defaultMaxAttachmentBytes = 20 * 1024 * 1024
)

var (
	ErrChatAttachmentUnavailable = errors.New("chat attachment storage is not configured")
	ErrChatAttachmentNotFound    = errors.New("chat attachment not found")
	ErrChatAttachmentTooLarge    = errors.New("chat attachment is too large")
	ErrTooManyPendingAttachments = errors.New("too many unreferenced chat attachments")
)

var attachmentContentTypes = map[string]bool{
	"image/jpeg":               true,
	"image/png":                true,
	"image/webp":               true,
	"application/octet-stream": true,
}

// BlobStore persists ciphertext blobs keyed by (owner, blob ID). The chat
// service holds no key material; it only stores and serves opaque ciphertext.
// *image.Store satisfies this interface.
type BlobStore interface {
	SaveCiphertext(ownerID, blobID string, ciphertext io.Reader) (path string, cipherSHA256 string, err error)
	ReadCiphertext(ownerID, blobID string, maxBytes int64) ([]byte, error)
	DeleteCiphertext(ownerID, blobID string) error
}

// Attachment is the ciphertext-only metadata for one chat photo. The server
// never receives the image key; nonce/algorithm/key_version are opaque strings
// the client uses to decrypt, exactly like a chat message.
type Attachment struct {
	ID           string `json:"id"`
	ChatID       string `json:"chat_id"`
	ContentType  string `json:"content_type"`
	SizeBytes    int64  `json:"size_bytes"`
	CipherSHA256 string `json:"cipher_sha256"`
	Nonce        string `json:"nonce"`
	Algorithm    string `json:"algorithm"`
	KeyVersion   string `json:"key_version"`
	CreatedAt    string `json:"created_at"`
}

// AttachmentInput carries the metadata headers plus the ciphertext body of an
// upload. Body must be AES-256-GCM ciphertext; plaintext is never written.
type AttachmentInput struct {
	ContentType string
	Nonce       string
	Algorithm   string
	KeyVersion  string
	Body        io.Reader
}

// AttachmentsEnabled reports whether a blob store is configured.
func (s *Service) AttachmentsEnabled() bool { return s != nil && s.blobs != nil }

// MaxAttachmentBytes is the ciphertext size cap for one chat photo.
func (s *Service) MaxAttachmentBytes() int64 {
	if s == nil || s.maxAttachmentBytes <= 0 {
		return defaultMaxAttachmentBytes
	}
	return s.maxAttachmentBytes
}

// UploadAttachment stores one ciphertext blob bound to the caller's chat. The
// attachment stays unreferenced (message_id IS NULL) until a message.send that
// names it; a periodic sweep removes uploads that are never referenced.
func (s *Service) UploadAttachment(ctx context.Context, userID, chatID string, input AttachmentInput, now time.Time) (Attachment, error) {
	if s == nil || s.db == nil {
		return Attachment{}, ErrChatNotFound
	}
	if s.blobs == nil {
		return Attachment{}, ErrChatAttachmentUnavailable
	}
	if err := validateAttachmentInput(input); err != nil {
		return Attachment{}, err
	}
	access, err := s.loadChat(ctx, userID, chatID, false)
	if err != nil {
		return Attachment{}, err
	}
	if access.MatchStatus != "accepted" {
		return Attachment{}, ErrChatNotAvailable
	}

	var pending int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM chat_attachments
		WHERE chat_id=$1 AND uploader_user_id=$2 AND message_id IS NULL AND deleted_at IS NULL`,
		access.ChatID, userID).Scan(&pending); err != nil {
		return Attachment{}, err
	}
	if pending >= maxPendingAttachments {
		return Attachment{}, ErrTooManyPendingAttachments
	}

	id, err := randomID()
	if err != nil {
		return Attachment{}, err
	}
	if input.Body == nil {
		return Attachment{}, ErrChatInvalidInput
	}
	counted := &countingReader{reader: io.LimitReader(input.Body, s.maxAttachmentBytes+1)}
	storagePath, cipherHash, err := s.blobs.SaveCiphertext(userID, id, counted)
	if err != nil {
		return Attachment{}, err
	}
	if counted.count > s.maxAttachmentBytes {
		_ = s.blobs.DeleteCiphertext(userID, id)
		return Attachment{}, ErrChatAttachmentTooLarge
	}
	if counted.count < attachmentMinCiphertext {
		_ = s.blobs.DeleteCiphertext(userID, id)
		return Attachment{}, ErrChatInvalidInput
	}

	created := now.UTC().Format(time.RFC3339Nano)
	var attachment Attachment
	if err := s.db.QueryRowContext(ctx, `
		INSERT INTO chat_attachments (id,chat_id,uploader_user_id,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,storage_path,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id,chat_id,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,created_at`,
		id, access.ChatID, userID, input.ContentType, counted.count, cipherHash, input.Nonce, input.Algorithm, input.KeyVersion, storagePath, created).Scan(
		&attachment.ID, &attachment.ChatID, &attachment.ContentType, &attachment.SizeBytes, &attachment.CipherSHA256,
		&attachment.Nonce, &attachment.Algorithm, &attachment.KeyVersion, &attachment.CreatedAt); err != nil {
		_ = s.blobs.DeleteCiphertext(userID, id)
		return Attachment{}, err
	}
	return attachment, nil
}

// OpenAttachment returns the ciphertext of one attachment to any participant of
// its chat (accepted or completed match), never to a blocked or outside user.
func (s *Service) OpenAttachment(ctx context.Context, userID, chatID, attachmentID string) (Attachment, []byte, error) {
	if s == nil || s.db == nil {
		return Attachment{}, nil, ErrChatNotFound
	}
	if s.blobs == nil {
		return Attachment{}, nil, ErrChatAttachmentUnavailable
	}
	if strings.TrimSpace(attachmentID) == "" {
		return Attachment{}, nil, ErrChatAttachmentNotFound
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return Attachment{}, nil, err
	}
	var attachment Attachment
	var uploaderID, storagePath string
	err = s.db.QueryRowContext(ctx, `
		SELECT id,chat_id,uploader_user_id,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,storage_path,created_at
		FROM chat_attachments
		WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL`, attachmentID, access.ChatID).Scan(
		&attachment.ID, &attachment.ChatID, &uploaderID, &attachment.ContentType, &attachment.SizeBytes, &attachment.CipherSHA256,
		&attachment.Nonce, &attachment.Algorithm, &attachment.KeyVersion, &storagePath, &attachment.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Attachment{}, nil, ErrChatAttachmentNotFound
	}
	if err != nil {
		return Attachment{}, nil, err
	}
	data, err := s.blobs.ReadCiphertext(uploaderID, attachmentID, s.maxAttachmentBytes+1)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Attachment{}, nil, ErrChatAttachmentNotFound
		}
		return Attachment{}, nil, err
	}
	if hash := sha256.Sum256(data); hex.EncodeToString(hash[:]) != attachment.CipherSHA256 {
		return Attachment{}, nil, errors.New("chat attachment hash mismatch")
	}
	return attachment, data, nil
}

// linkAttachmentTx binds an uploaded attachment to the message that references
// it. It is a no-op error if the attachment is not the caller's, belongs to
// another chat, is already linked, or is deleted.
func linkAttachmentTx(ctx context.Context, tx *sql.Tx, chatID, uploaderID, attachmentID, messageID, stamp string) error {
	result, err := tx.ExecContext(ctx, `
		UPDATE chat_attachments
		SET message_id=$1, linked_at=$2
		WHERE id=$3 AND chat_id=$4 AND uploader_user_id=$5 AND message_id IS NULL AND deleted_at IS NULL`,
		messageID, stamp, attachmentID, chatID, uploaderID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrChatAttachmentNotFound
	}
	return nil
}

// attachmentByMessageID loads the attachment linked to one message, or nil.
func (s *Service) attachmentByMessageID(ctx context.Context, messageID string) (*Attachment, error) {
	var a Attachment
	err := s.db.QueryRowContext(ctx, `
		SELECT id,chat_id,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,created_at
		FROM chat_attachments WHERE message_id=$1 AND deleted_at IS NULL`, messageID).Scan(
		&a.ID, &a.ChatID, &a.ContentType, &a.SizeBytes, &a.CipherSHA256, &a.Nonce, &a.Algorithm, &a.KeyVersion, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ProcessExpiredAttachments removes uploads that were never referenced by a
// message within ttl. Blob deletion is idempotent, so it is safe to run on
// every startup.
func (s *Service) ProcessExpiredAttachments(ctx context.Context, ttl time.Duration, now time.Time) error {
	if s == nil || s.db == nil || s.blobs == nil {
		return nil
	}
	cutoff := now.Add(-ttl).UTC().Format(time.RFC3339Nano)
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,uploader_user_id FROM chat_attachments
		WHERE message_id IS NULL AND deleted_at IS NULL AND created_at < $1
		ORDER BY created_at
		LIMIT $2`, cutoff, attachmentSweepBatch)
	if err != nil {
		return err
	}
	type pending struct{ id, uploader string }
	targets := make([]pending, 0)
	for rows.Next() {
		var t pending
		if err := rows.Scan(&t.id, &t.uploader); err != nil {
			_ = rows.Close()
			return err
		}
		targets = append(targets, t)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var firstErr error
	for _, t := range targets {
		if err := s.blobs.DeleteCiphertext(t.uploader, t.id); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if _, err := s.db.ExecContext(ctx, `DELETE FROM chat_attachments WHERE id=$1 AND message_id IS NULL`, t.id); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func validateAttachmentInput(input AttachmentInput) error {
	if input.Algorithm != attachmentAlgorithm || !validIdentifier(input.KeyVersion, maxKeyVersion) {
		return ErrChatInvalidInput
	}
	if !attachmentContentTypes[input.ContentType] {
		return ErrChatInvalidInput
	}
	nonce, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(input.Nonce))
	if err != nil || len(nonce) != 12 {
		return ErrChatInvalidInput
	}
	return nil
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
