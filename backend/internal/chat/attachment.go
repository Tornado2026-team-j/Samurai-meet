package chat

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/accountscope"
)

const (
	attachmentAlgorithm         = "AES-256-GCM"
	attachmentKeyVersion        = "chat-attachment-e2ee-v1"
	attachmentDeviceKeyVersion  = "x25519-v1"
	attachmentWrappingAlgorithm = "X25519-HKDF-SHA256-AES-256-GCM"
	attachmentMinCiphertext     = 16
	maxPendingAttachments       = 10
	maxAttachmentRecipients     = 32
	maxAttachmentEnvelopeBytes  = 16 * 1024
	attachmentSweepBatch        = 500
	defaultMaxAttachmentBytes   = 20 * 1024 * 1024
)

// These values are part of the client/server attachment protocol. The
// agreement key is the X25519 public half registered beside the Ed25519 Key-B
// proof key; the corresponding private key remains on the device.
const (
	ChatAttachmentKeyVersion        = attachmentKeyVersion
	ChatAttachmentDeviceKeyVersion  = attachmentDeviceKeyVersion
	ChatAttachmentWrappingAlgorithm = attachmentWrappingAlgorithm
)

var (
	ErrChatAttachmentUnavailable = errors.New("chat attachment storage is not configured")
	ErrChatAttachmentNotFound    = errors.New("chat attachment not found")
	ErrChatAttachmentKeysMissing = errors.New("chat attachment recipient keys are unavailable")
	ErrChatAttachmentTooLarge    = errors.New("chat attachment is too large")
	ErrTooManyPendingAttachments = errors.New("too many unreferenced chat attachments")
)

var attachmentContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
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
	// BodyHash is the device-proof body hash. It is checked against the bytes
	// read from BlobStore so a signed header cannot be substituted for the
	// actual ciphertext body.
	BodyHash string
	Body     io.Reader
}

// AttachmentKeyRecipient is public per-device X25519 metadata. It never
// contains the Ed25519 proof public key or any private key material.
type AttachmentKeyRecipient struct {
	UserID     string `json:"user_id"`
	DeviceID   string `json:"device_id"`
	KeyVersion string `json:"key_version"`
	PublicKey  string `json:"public_key"`
}

// AttachmentKeyEnvelopeInput is an opaque, client-created content-key
// envelope. The service validates its binding metadata but never decrypts it.
type AttachmentKeyEnvelopeInput struct {
	UserID            string `json:"user_id"`
	DeviceID          string `json:"device_id"`
	KeyVersion        string `json:"key_version"`
	PublicKey         string `json:"public_key"`
	WrappingAlgorithm string `json:"algorithm"`
	Envelope          string `json:"envelope"`
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
	access, err := s.loadChat(ctx, userID, chatID, false)
	if err != nil {
		return Attachment{}, err
	}
	switch access.AccountType {
	case accountscope.Regular:
		if err := validateAttachmentInput(input); err != nil {
			return Attachment{}, err
		}
	case accountscope.Demo:
		if err := validateDemoAttachmentInput(input); err != nil {
			return Attachment{}, err
		}
	default:
		return Attachment{}, ErrChatAttachmentKeysMissing
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
	if bodyHash := strings.TrimSpace(input.BodyHash); bodyHash != "" {
		expected, decodeErr := base64.RawURLEncoding.DecodeString(bodyHash)
		actual, actualErr := hex.DecodeString(cipherHash)
		if decodeErr != nil || actualErr != nil || len(expected) != sha256.Size || len(actual) != sha256.Size || subtle.ConstantTimeCompare(expected, actual) != 1 {
			_ = s.blobs.DeleteCiphertext(userID, id)
			return Attachment{}, ErrChatInvalidInput
		}
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
func (s *Service) OpenAttachment(ctx context.Context, userID, chatID, attachmentID, deviceID string) (Attachment, []byte, string, error) {
	attachment, uploaderID, envelope, err := s.loadAttachmentForDevice(ctx, userID, chatID, attachmentID, deviceID)
	if err != nil {
		return Attachment{}, nil, "", err
	}
	data, err := s.blobs.ReadCiphertext(uploaderID, attachmentID, s.maxAttachmentBytes+1)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Attachment{}, nil, "", ErrChatAttachmentNotFound
		}
		return Attachment{}, nil, "", err
	}
	if hash := sha256.Sum256(data); hex.EncodeToString(hash[:]) != attachment.CipherSHA256 {
		return Attachment{}, nil, "", errors.New("chat attachment hash mismatch")
	}
	return attachment, data, envelope, nil
}

// OpenDemoAttachment returns a Demo ciphertext without entering the normal
// device-proof/envelope protocol. Both Demo participants derive the same
// chat key locally, so no image key or device envelope is needed here.
func (s *Service) OpenDemoAttachment(ctx context.Context, userID, chatID, attachmentID string) (Attachment, []byte, error) {
	if s == nil || s.db == nil || s.blobs == nil || strings.TrimSpace(attachmentID) == "" {
		return Attachment{}, nil, ErrChatAttachmentNotFound
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return Attachment{}, nil, err
	}
	if access.AccountType != accountscope.Demo {
		return Attachment{}, nil, ErrChatAttachmentNotFound
	}
	attachment, uploaderID, err := s.loadDemoAttachment(ctx, access.ChatID, attachmentID)
	if err != nil {
		return Attachment{}, nil, err
	}
	if attachment.SizeBytes < attachmentMinCiphertext || attachment.SizeBytes > s.MaxAttachmentBytes() {
		return Attachment{}, nil, ErrChatAttachmentNotFound
	}
	data, err := s.blobs.ReadCiphertext(uploaderID, attachmentID, s.maxAttachmentBytes+1)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Attachment{}, nil, ErrChatAttachmentNotFound
		}
		return Attachment{}, nil, err
	}
	if int64(len(data)) != attachment.SizeBytes {
		return Attachment{}, nil, errors.New("chat attachment size mismatch")
	}
	if hash := sha256.Sum256(data); hex.EncodeToString(hash[:]) != attachment.CipherSHA256 {
		return Attachment{}, nil, errors.New("chat attachment hash mismatch")
	}
	return attachment, data, nil
}

// OpenAttachmentEnvelope returns only the opaque envelope and ciphertext
// metadata. It deliberately does not read the blob, and is used by the
// device-proofed JSON envelope endpoint so the envelope is not exposed as a
// response header in proxies or native networking diagnostics.
func (s *Service) OpenAttachmentEnvelope(ctx context.Context, userID, chatID, attachmentID, deviceID string) (Attachment, string, error) {
	attachment, _, envelope, err := s.loadAttachmentForDevice(ctx, userID, chatID, attachmentID, deviceID)
	if err != nil {
		return Attachment{}, "", err
	}
	return attachment, envelope, nil
}

func (s *Service) loadAttachmentForDevice(ctx context.Context, userID, chatID, attachmentID, deviceID string) (Attachment, string, string, error) {
	if s == nil || s.db == nil {
		return Attachment{}, "", "", ErrChatNotFound
	}
	if s.blobs == nil {
		return Attachment{}, "", "", ErrChatAttachmentUnavailable
	}
	if strings.TrimSpace(attachmentID) == "" || strings.TrimSpace(deviceID) == "" {
		return Attachment{}, "", "", ErrChatAttachmentNotFound
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return Attachment{}, "", "", err
	}
	if access.AccountType != accountscope.Regular {
		return Attachment{}, "", "", ErrChatAttachmentNotFound
	}
	var attachment Attachment
	var uploaderID, storagePath string
	err = s.db.QueryRowContext(ctx, `
		SELECT id,chat_id,uploader_user_id,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,storage_path,created_at
		FROM chat_attachments
		WHERE id=$1 AND chat_id=$2 AND message_id IS NOT NULL AND deleted_at IS NULL`, attachmentID, access.ChatID).Scan(
		&attachment.ID, &attachment.ChatID, &uploaderID, &attachment.ContentType, &attachment.SizeBytes, &attachment.CipherSHA256,
		&attachment.Nonce, &attachment.Algorithm, &attachment.KeyVersion, &storagePath, &attachment.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Attachment{}, "", "", ErrChatAttachmentNotFound
	}
	if err != nil {
		return Attachment{}, "", "", err
	}
	var envelope string
	err = s.db.QueryRowContext(ctx, `
		SELECT e.envelope
		FROM chat_attachment_key_envelopes e
		JOIN devices d ON d.user_id=e.user_id AND d.device_id=e.device_id
		WHERE e.attachment_id=$1 AND e.user_id=$2 AND e.device_id=$3
		  AND d.agreement_key_version=$4`, attachmentID, userID, deviceID, attachmentDeviceKeyVersion).Scan(&envelope)
	if errors.Is(err, sql.ErrNoRows) {
		// Do not reveal whether the attachment exists to a device without a
		// matching envelope. This also fails closed for pre-E2EE rows.
		return Attachment{}, "", "", ErrChatAttachmentNotFound
	}
	if err != nil {
		return Attachment{}, "", "", err
	}
	return attachment, uploaderID, envelope, nil
}

// ListAttachmentKeyRecipients returns every current device of both accepted
// chat participants that can receive a content-key envelope. A participant
// with an old device lacking the X25519 agreement key blocks an upload rather
// than creating an attachment that one of their devices cannot decrypt.
func (s *Service) ListAttachmentKeyRecipients(ctx context.Context, userID, chatID string) ([]AttachmentKeyRecipient, error) {
	if s == nil || s.db == nil {
		return nil, ErrChatNotFound
	}
	access, err := s.loadChat(ctx, userID, chatID, false)
	if err != nil {
		return nil, err
	}
	if access.AccountType != accountscope.Regular {
		return nil, ErrChatAttachmentKeysMissing
	}
	if access.MatchStatus != "accepted" {
		return nil, ErrChatNotAvailable
	}
	return attachmentKeyRecipients(ctx, s.db, access)
}

// SaveAttachmentKeyEnvelopes atomically stores the individual envelopes for
// all current participant devices. The server only compares public metadata;
// it never parses or decrypts the envelope payload.
func (s *Service) SaveAttachmentKeyEnvelopes(ctx context.Context, userID, chatID, attachmentID string, inputs []AttachmentKeyEnvelopeInput, now time.Time) error {
	if s == nil || s.db == nil {
		return ErrChatNotFound
	}
	if len(inputs) == 0 || len(inputs) > maxAttachmentRecipients {
		return ErrChatAttachmentKeysMissing
	}
	access, err := s.loadChat(ctx, userID, chatID, false)
	if err != nil {
		return err
	}
	if access.AccountType != accountscope.Regular {
		return ErrChatAttachmentKeysMissing
	}
	if access.MatchStatus != "accepted" {
		return ErrChatNotAvailable
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var uploaderID string
	var messageID, deletedAt sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT uploader_user_id,COALESCE(message_id,''),COALESCE(deleted_at,'')
		FROM chat_attachments
		WHERE id=$1 AND chat_id=$2
		FOR UPDATE`, attachmentID, access.ChatID).Scan(&uploaderID, &messageID, &deletedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrChatAttachmentNotFound
		}
		return err
	}
	if uploaderID != userID || messageID.String != "" || deletedAt.String != "" {
		return ErrChatAttachmentNotFound
	}
	expected, err := attachmentKeyRecipients(ctx, tx, access)
	if err != nil {
		return err
	}
	expectedByID := make(map[string]AttachmentKeyRecipient, len(expected))
	for _, recipient := range expected {
		expectedByID[attachmentRecipientKey(recipient.UserID, recipient.DeviceID)] = recipient
	}
	provided := make(map[string]AttachmentKeyEnvelopeInput, len(inputs))
	for _, input := range inputs {
		if err := validateAttachmentKeyEnvelopeInput(input); err != nil {
			return err
		}
		key := attachmentRecipientKey(input.UserID, input.DeviceID)
		if _, ok := expectedByID[key]; !ok {
			return ErrChatAttachmentKeysMissing
		}
		if _, duplicate := provided[key]; duplicate {
			return ErrChatInvalidInput
		}
		recipient := expectedByID[key]
		if input.KeyVersion != recipient.KeyVersion || input.PublicKey != recipient.PublicKey {
			return ErrChatAttachmentKeysMissing
		}
		provided[key] = input
	}
	if len(provided) != len(expected) {
		return ErrChatAttachmentKeysMissing
	}

	// A retry is safe only when it repeats the exact same opaque envelopes.
	// Never replace an existing envelope for a device in place. If a new device
	// appeared after an earlier save, accept the immutable existing subset and
	// insert only the newly required envelopes; linkAttachmentTx still requires
	// the complete current set before the message can reference this row.
	existingRows, err := tx.QueryContext(ctx, `
		SELECT user_id,device_id,target_key_version,target_public_key,wrapping_algorithm,envelope
		FROM chat_attachment_key_envelopes WHERE attachment_id=$1`, attachmentID)
	if err != nil {
		return err
	}
	existing := make(map[string]AttachmentKeyEnvelopeInput)
	for existingRows.Next() {
		var input AttachmentKeyEnvelopeInput
		if err := existingRows.Scan(&input.UserID, &input.DeviceID, &input.KeyVersion, &input.PublicKey, &input.WrappingAlgorithm, &input.Envelope); err != nil {
			_ = existingRows.Close()
			return err
		}
		existing[attachmentRecipientKey(input.UserID, input.DeviceID)] = input
	}
	if err := existingRows.Close(); err != nil {
		return err
	}
	for key, stored := range existing {
		recipient, stillExpected := expectedByID[key]
		input, included := provided[key]
		if !stillExpected || !included || stored != input || stored.KeyVersion != recipient.KeyVersion || stored.PublicKey != recipient.PublicKey {
			return ErrChatAttachmentKeysMissing
		}
	}

	stamp := now.UTC().Format(time.RFC3339Nano)
	for key, input := range provided {
		if _, alreadyStored := existing[key]; alreadyStored {
			continue
		}
		recipient := expectedByID[key]
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO chat_attachment_key_envelopes
			(attachment_id,user_id,device_id,target_key_version,target_public_key,wrapping_algorithm,envelope,created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			attachmentID, recipient.UserID, input.DeviceID,
			input.KeyVersion, input.PublicKey, input.WrappingAlgorithm, input.Envelope, stamp); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func attachmentKeyRecipients(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, access chatAccess) ([]AttachmentKeyRecipient, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT user_id,device_id,COALESCE(agreement_key_version,''),COALESCE(agreement_public_key,'')
		FROM devices
		WHERE user_id=$1 OR user_id=$2
		ORDER BY user_id,device_id`, access.OwnerUserID, access.RequesterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]AttachmentKeyRecipient, 0)
	for rows.Next() {
		var recipient AttachmentKeyRecipient
		if err := rows.Scan(&recipient.UserID, &recipient.DeviceID, &recipient.KeyVersion, &recipient.PublicKey); err != nil {
			return nil, err
		}
		if recipient.KeyVersion != attachmentDeviceKeyVersion || !validX25519PublicKey(recipient.PublicKey) {
			return nil, ErrChatAttachmentKeysMissing
		}
		result = append(result, recipient)
		if len(result) > maxAttachmentRecipients {
			return nil, ErrChatAttachmentKeysMissing
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(result) == 0 {
		return nil, ErrChatAttachmentKeysMissing
	}
	return result, nil
}

func validX25519PublicKey(encoded string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(encoded))
	return err == nil && len(decoded) == 32
}

func validateAttachmentKeyEnvelopeInput(input AttachmentKeyEnvelopeInput) error {
	input.UserID = strings.TrimSpace(input.UserID)
	input.DeviceID = strings.TrimSpace(input.DeviceID)
	input.KeyVersion = strings.TrimSpace(input.KeyVersion)
	input.PublicKey = strings.TrimSpace(input.PublicKey)
	input.WrappingAlgorithm = strings.TrimSpace(input.WrappingAlgorithm)
	input.Envelope = strings.TrimSpace(input.Envelope)
	if !validIdentifier(input.UserID, maxClientMessageID) ||
		!validIdentifier(input.DeviceID, maxClientMessageID) ||
		input.KeyVersion != attachmentDeviceKeyVersion ||
		input.WrappingAlgorithm != attachmentWrappingAlgorithm ||
		!validX25519PublicKey(input.PublicKey) ||
		input.Envelope == "" || len(input.Envelope) > maxAttachmentEnvelopeBytes {
		return ErrChatInvalidInput
	}
	decoded, err := base64.RawURLEncoding.DecodeString(input.Envelope)
	if err != nil || len(decoded) < 32 {
		return ErrChatInvalidInput
	}
	return nil
}

// linkAttachmentTx binds an uploaded attachment to the message that references
// it. It is a no-op error if the attachment is not the caller's, belongs to
// another chat, is already linked, or is deleted.
func linkAttachmentTx(ctx context.Context, tx *sql.Tx, access chatAccess, uploaderID, attachmentID, messageID, stamp string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM chat_attachments
			WHERE id=$1 AND chat_id=$2 AND uploader_user_id=$3 AND message_id IS NULL AND deleted_at IS NULL
		)`, attachmentID, access.ChatID, uploaderID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrChatAttachmentNotFound
	}
	if err := ensureAttachmentReadyTx(ctx, tx, access, attachmentID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE chat_attachments
		SET message_id=$1, linked_at=$2
		WHERE id=$3 AND chat_id=$4 AND uploader_user_id=$5 AND message_id IS NULL AND deleted_at IS NULL`,
		messageID, stamp, attachmentID, access.ChatID, uploaderID)
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

func ensureAttachmentReadyTx(ctx context.Context, tx *sql.Tx, access chatAccess, attachmentID string) error {
	var keyVersion, algorithm string
	if err := tx.QueryRowContext(ctx, `
		SELECT key_version,algorithm
		FROM chat_attachments
		WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL`, attachmentID, access.ChatID).Scan(&keyVersion, &algorithm); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrChatAttachmentNotFound
		}
		return err
	}
	if access.AccountType == accountscope.Demo {
		if keyVersion != DemoChatKeyVersion || algorithm != DemoChatAlgorithm {
			return ErrChatAttachmentKeysMissing
		}
		return nil
	}
	if access.AccountType != accountscope.Regular || keyVersion != attachmentKeyVersion || algorithm != attachmentAlgorithm {
		return ErrChatAttachmentKeysMissing
	}
	expected, err := attachmentKeyRecipients(ctx, tx, access)
	if err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT user_id,device_id,target_key_version,target_public_key
		FROM chat_attachment_key_envelopes WHERE attachment_id=$1`, attachmentID)
	if err != nil {
		return err
	}
	actual := make(map[string]AttachmentKeyRecipient, len(expected))
	for rows.Next() {
		var recipient AttachmentKeyRecipient
		if err := rows.Scan(&recipient.UserID, &recipient.DeviceID, &recipient.KeyVersion, &recipient.PublicKey); err != nil {
			_ = rows.Close()
			return err
		}
		actual[attachmentRecipientKey(recipient.UserID, recipient.DeviceID)] = recipient
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(actual) != len(expected) {
		return ErrChatAttachmentKeysMissing
	}
	for _, recipient := range expected {
		stored, ok := actual[attachmentRecipientKey(recipient.UserID, recipient.DeviceID)]
		if !ok || stored.KeyVersion != recipient.KeyVersion || stored.PublicKey != recipient.PublicKey {
			return ErrChatAttachmentKeysMissing
		}
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

// ProcessExpiredAttachments deletes the ciphertext blob of every attachment
// that is done for: an upload never referenced by a message within ttl, or one
// already tombstoned (deleted_at set) by the retention sweep because its message
// aged out. It first marks an unreferenced row deleted, so a concurrent message
// transaction cannot link the attachment after its blob has been selected for
// deletion. Blob deletion is idempotent and marked rows are retried on the next
// sweep when storage is temporarily unavailable.
func (s *Service) ProcessExpiredAttachments(ctx context.Context, ttl time.Duration, now time.Time) error {
	if s == nil || s.db == nil || s.blobs == nil {
		return nil
	}
	cutoff := now.Add(-ttl).UTC().Format(time.RFC3339Nano)
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,uploader_user_id FROM chat_attachments
		WHERE deleted_at IS NOT NULL
		   OR (message_id IS NULL AND created_at < $1)
		ORDER BY COALESCE(deleted_at, created_at)
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
		var claimedUploader string
		claimStamp := now.UTC().Format(time.RFC3339Nano)
		err := s.db.QueryRowContext(ctx, `
			UPDATE chat_attachments
			SET deleted_at=COALESCE(deleted_at,$1)
			WHERE id=$2 AND (message_id IS NULL OR deleted_at IS NOT NULL)
			RETURNING uploader_user_id`, claimStamp, t.id).Scan(&claimedUploader)
		if errors.Is(err, sql.ErrNoRows) {
			// A concurrent SendMessage linked it first (message_id set, not
			// tombstoned); its blob must remain.
			continue
		}
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := s.blobs.DeleteCiphertext(claimedUploader, t.id); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if _, err := s.db.ExecContext(ctx, `DELETE FROM chat_attachments WHERE id=$1 AND deleted_at IS NOT NULL`, t.id); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func validateAttachmentInput(input AttachmentInput) error {
	if input.Algorithm != attachmentAlgorithm || input.KeyVersion != attachmentKeyVersion {
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

func validateDemoAttachmentInput(input AttachmentInput) error {
	if input.Algorithm != DemoChatAlgorithm || input.KeyVersion != DemoChatKeyVersion {
		return ErrChatInvalidInput
	}
	if !attachmentContentTypes[input.ContentType] {
		return ErrChatInvalidInput
	}
	nonce, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(input.Nonce))
	if err != nil || len(nonce) != 12 || base64.RawURLEncoding.EncodeToString(nonce) != input.Nonce {
		return ErrChatInvalidInput
	}
	return nil
}

func (s *Service) loadDemoAttachment(ctx context.Context, chatID, attachmentID string) (Attachment, string, error) {
	var attachment Attachment
	var uploaderID string
	err := s.db.QueryRowContext(ctx, `
		SELECT id,chat_id,uploader_user_id,content_type,size_bytes,cipher_sha256,nonce,algorithm,key_version,created_at
		FROM chat_attachments
		WHERE id=$1 AND chat_id=$2 AND message_id IS NOT NULL AND deleted_at IS NULL`, attachmentID, chatID).Scan(
		&attachment.ID, &attachment.ChatID, &uploaderID, &attachment.ContentType, &attachment.SizeBytes, &attachment.CipherSHA256,
		&attachment.Nonce, &attachment.Algorithm, &attachment.KeyVersion, &attachment.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Attachment{}, "", ErrChatAttachmentNotFound
	}
	if err != nil {
		return Attachment{}, "", err
	}
	if attachment.Algorithm != DemoChatAlgorithm || attachment.KeyVersion != DemoChatKeyVersion ||
		!attachmentContentTypes[attachment.ContentType] || !validDemoAttachmentNonce(attachment.Nonce) {
		return Attachment{}, "", ErrChatAttachmentNotFound
	}
	return attachment, uploaderID, nil
}

func validDemoAttachmentNonce(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == 12 && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func attachmentRecipientKey(userID, deviceID string) string {
	return userID + "\x00" + deviceID
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
