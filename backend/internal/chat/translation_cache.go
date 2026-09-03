package chat

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	chatTranslationAlgorithm        = "AES-256-GCM"
	chatTranslationKeyVersion       = "chat-translation-dek-v1"
	legacyChatTranslationKeyVersion = "chat-translation-keyb-v1"
	chatMessageKeyVersion           = "chat-dek-v1"
	plaintextCommitmentDomain       = "samurai-meet:chat-message-plaintext-commitment/v2"
	legacyPlaintextCommitmentDomain = "samurai-meet:chat-message-plaintext-commitment/v1"
	maxMessageRevision              = 128
	maxTranslationTextRunes         = 2_000
)

var (
	ErrMessageTranslationStale    = errors.New("message changed while translation was in flight")
	ErrTranslationBindingMissing  = errors.New("message translation binding is unavailable")
	ErrTranslationBindingMismatch = errors.New("message translation text does not match message binding")
)

type translationQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type translationExecer interface {
	translationQueryer
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type storedMessageTranslation struct {
	MessageID string
	EncryptedMessageTranslation
}

type messageTranslationMetadata struct {
	Revision       string
	KeyVersion     string
	Commitment     string
	CommitmentSalt string
}

// LookupMessageTranslation returns a cached encrypted result only for the
// current text revision. The server does not need the translation plaintext on
// a cache hit and therefore does not send it to the provider again.
func (s *Service) LookupMessageTranslation(
	ctx context.Context,
	userID string,
	chatID string,
	messageID string,
	targetLanguage string,
) (EncryptedMessageTranslation, bool, string, error) {
	targetLanguage, err := normalizeTranslationTarget(targetLanguage)
	if err != nil {
		return EncryptedMessageTranslation{}, false, "", err
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return EncryptedMessageTranslation{}, false, "", err
	}
	revision, err := s.messageTranslationRevision(ctx, s.db, access.ChatID, messageID, false)
	if err != nil {
		return EncryptedMessageTranslation{}, false, "", err
	}

	var cached EncryptedMessageTranslation
	err = s.db.QueryRowContext(ctx, `
		SELECT target_language,ciphertext,nonce,algorithm,key_version,message_revision
		FROM chat_message_translations
		WHERE message_id=$1 AND target_language=$2`, messageID, targetLanguage).Scan(
		&cached.TargetLanguage, &cached.Ciphertext, &cached.Nonce, &cached.Algorithm,
		&cached.KeyVersion, &cached.MessageRevision)
	if errors.Is(err, sql.ErrNoRows) {
		return EncryptedMessageTranslation{}, false, revision, nil
	}
	if err != nil {
		return EncryptedMessageTranslation{}, false, revision, err
	}
	if cached.MessageRevision != revision || !validStoredEncryptedMessageTranslation(cached) {
		return EncryptedMessageTranslation{}, false, revision, nil
	}
	return cached, true, revision, nil
}

// SaveMessageTranslation stores an encrypted provider result only when the
// message still has the revision that was translated. A concurrent edit wins;
// stale translation ciphertext is never attached to the new message text.
func (s *Service) SaveMessageTranslation(
	ctx context.Context,
	userID string,
	chatID string,
	messageID string,
	input EncryptedMessageTranslation,
	now time.Time,
) error {
	targetLanguage, err := normalizeTranslationTarget(input.TargetLanguage)
	if err != nil {
		return err
	}
	input.TargetLanguage = targetLanguage
	if !validIdentifier(messageID, maxClientMessageID) || !validEncryptedMessageTranslation(input) {
		return ErrChatInvalidInput
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	revision, err := s.messageTranslationRevision(ctx, tx, access.ChatID, messageID, true)
	if err != nil {
		return err
	}
	if revision != input.MessageRevision {
		return ErrMessageTranslationStale
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO chat_message_translations
			(message_id,target_language,ciphertext,nonce,algorithm,key_version,message_revision,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
		ON CONFLICT (message_id,target_language) DO UPDATE SET
			ciphertext=EXCLUDED.ciphertext,
			nonce=EXCLUDED.nonce,
			algorithm=EXCLUDED.algorithm,
			key_version=EXCLUDED.key_version,
			message_revision=EXCLUDED.message_revision,
			updated_at=EXCLUDED.updated_at`,
		messageID, input.TargetLanguage, input.Ciphertext, input.Nonce, input.Algorithm,
		input.KeyVersion, input.MessageRevision, stamp); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) messageTranslationRevision(
	ctx context.Context,
	queryer translationQueryer,
	chatID string,
	messageID string,
	lock bool,
) (string, error) {
	metadata, err := s.messageTranslationMetadata(ctx, queryer, chatID, messageID, lock)
	if err != nil {
		return "", err
	}
	return metadata.Revision, nil
}

func (s *Service) messageTranslationRevisionForText(
	ctx context.Context,
	queryer translationQueryer,
	chatID string,
	messageID string,
	text string,
	commitmentKey string,
	lock bool,
	migrateLegacy bool,
) (string, error) {
	if strings.TrimSpace(text) == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > maxTranslationTextRunes {
		return "", ErrChatInvalidInput
	}
	metadata, err := s.messageTranslationMetadata(ctx, queryer, chatID, messageID, lock)
	if err != nil {
		return "", err
	}
	if metadata.KeyVersion != chatMessageKeyVersion {
		return "", ErrTranslationBindingMissing
	}
	if !validPlaintextBinding(metadata.Commitment, metadata.CommitmentSalt) {
		return "", ErrTranslationBindingMissing
	}
	if expected, valid := plaintextCommitment(text, metadata.CommitmentSalt, commitmentKey); valid && subtle.ConstantTimeCompare([]byte(expected), []byte(metadata.Commitment)) == 1 {
		return metadata.Revision, nil
	}
	// Messages written before the keyed commitment rollout can be upgraded by
	// a client that still has the chat DEK. They are never sent to the provider
	// under the old public-salt-only binding, and a DB-only reader cannot perform
	// this upgrade because it does not have the client-held commitment key.
	if subtle.ConstantTimeCompare([]byte(legacyPlaintextCommitment(text, metadata.CommitmentSalt)), []byte(metadata.Commitment)) == 1 {
		if !migrateLegacy {
			return "", ErrTranslationBindingMissing
		}
		expected, valid := plaintextCommitment(text, metadata.CommitmentSalt, commitmentKey)
		if !valid {
			return "", ErrTranslationBindingMissing
		}
		execer, ok := queryer.(translationExecer)
		if !ok {
			return "", ErrTranslationBindingMissing
		}
		if _, err := execer.ExecContext(ctx, `
			UPDATE messages SET plaintext_commitment=$1
			WHERE id=$2 AND chat_id=$3 AND deleted_at IS NULL`, expected, messageID, chatID); err != nil {
			return "", err
		}
		return metadata.Revision, nil
	}
	return "", ErrTranslationBindingMismatch
}

func (s *Service) messageTranslationMetadata(
	ctx context.Context,
	queryer translationQueryer,
	chatID string,
	messageID string,
	lock bool,
) (messageTranslationMetadata, error) {
	if !validIdentifier(messageID, maxClientMessageID) {
		return messageTranslationMetadata{}, ErrChatInvalidInput
	}
	query := `
		SELECT content_type,key_version,COALESCE(edited_at,''),created_at,deleted_at,
		       COALESCE(plaintext_commitment,''),COALESCE(plaintext_commitment_salt,'')
		FROM messages WHERE id=$1 AND chat_id=$2`
	if lock {
		query += " FOR UPDATE"
	}
	var contentType, editedAt, createdAt string
	var deletedAt sql.NullString
	var metadata messageTranslationMetadata
	if err := queryer.QueryRowContext(ctx, query, messageID, chatID).Scan(
		&contentType, &metadata.KeyVersion, &editedAt, &createdAt, &deletedAt, &metadata.Commitment, &metadata.CommitmentSalt); errors.Is(err, sql.ErrNoRows) {
		return messageTranslationMetadata{}, ErrMessageNotFound
	} else if err != nil {
		return messageTranslationMetadata{}, err
	}
	if deletedAt.Valid {
		return messageTranslationMetadata{}, ErrMessageNotFound
	}
	if contentType != "text" {
		return messageTranslationMetadata{}, ErrChatInvalidInput
	}
	if editedAt != "" {
		metadata.Revision = editedAt
	} else {
		metadata.Revision = createdAt
	}
	return metadata, nil
}

func validPlaintextBinding(commitment, salt string) bool {
	commitmentBytes, commitmentErr := base64.RawURLEncoding.DecodeString(strings.TrimSpace(commitment))
	saltBytes, saltErr := base64.RawURLEncoding.DecodeString(strings.TrimSpace(salt))
	return commitmentErr == nil && len(commitmentBytes) == sha256.Size && saltErr == nil && len(saltBytes) == 16
}

func plaintextCommitment(text, salt, commitmentKey string) (string, bool) {
	key, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(commitmentKey))
	if err != nil || len(key) != sha256.Size {
		return "", false
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(plaintextCommitmentDomain + "\n" + strings.TrimSpace(salt) + "\n" + strings.TrimSpace(text)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), true
}

func legacyPlaintextCommitment(text, salt string) string {
	digest := sha256.Sum256([]byte(legacyPlaintextCommitmentDomain + "\n" + strings.TrimSpace(salt) + "\n" + strings.TrimSpace(text)))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (s *Service) loadMessageTranslations(ctx context.Context, messages []Message) error {
	if len(messages) == 0 {
		return nil
	}
	placeholders := make([]string, len(messages))
	args := make([]any, len(messages))
	for index, message := range messages {
		placeholders[index] = fmt.Sprintf("$%d", index+1)
		args[index] = message.ID
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT message_id,target_language,ciphertext,nonce,algorithm,key_version,message_revision
		FROM chat_message_translations
		WHERE message_id IN (%s)
		ORDER BY message_id,target_language`, strings.Join(placeholders, ",")), args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	byMessage := make(map[string][]storedMessageTranslation, len(messages))
	for rows.Next() {
		var item storedMessageTranslation
		if err := rows.Scan(&item.MessageID, &item.TargetLanguage, &item.Ciphertext, &item.Nonce,
			&item.Algorithm, &item.KeyVersion, &item.MessageRevision); err != nil {
			return err
		}
		byMessage[item.MessageID] = append(byMessage[item.MessageID], item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := 0; index < len(messages); index++ {
		if messages[index].ContentType != "text" {
			continue
		}
		revision := messageRevision(messages[index])
		for _, stored := range byMessage[messages[index].ID] {
			if stored.MessageRevision == revision && validStoredEncryptedMessageTranslation(stored.EncryptedMessageTranslation) {
				messages[index].Translations = append(messages[index].Translations, stored.EncryptedMessageTranslation)
			}
		}
	}
	return nil
}

func normalizeTranslationTarget(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value != "ja" && value != "en" {
		return "", ErrChatInvalidInput
	}
	return value, nil
}

func validEncryptedMessageTranslation(value EncryptedMessageTranslation) bool {
	return validEncryptedMessageTranslationVersion(value, false)
}

func validStoredEncryptedMessageTranslation(value EncryptedMessageTranslation) bool {
	return validEncryptedMessageTranslationVersion(value, true)
}

func validEncryptedMessageTranslationVersion(value EncryptedMessageTranslation, allowLegacy bool) bool {
	if _, err := normalizeTranslationTarget(value.TargetLanguage); err != nil ||
		value.Algorithm != chatTranslationAlgorithm ||
		!validIdentifier(value.MessageRevision, maxMessageRevision) {
		return false
	}
	if value.KeyVersion != chatTranslationKeyVersion && (!allowLegacy || value.KeyVersion != legacyChatTranslationKeyVersion) {
		return false
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value.Ciphertext))
	if err != nil || len(ciphertext) < 16 || len(ciphertext) > maxCiphertextBytes {
		return false
	}
	nonce, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value.Nonce))
	return err == nil && len(nonce) == 12 && utf8.ValidString(value.Ciphertext) && utf8.ValidString(value.Nonce)
}

func messageRevision(message Message) string {
	if message.EditedAt != "" {
		return message.EditedAt
	}
	return message.CreatedAt
}
