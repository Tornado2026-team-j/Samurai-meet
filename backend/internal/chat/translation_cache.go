package chat

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	chatTranslationAlgorithm  = "AES-256-GCM"
	chatTranslationKeyVersion = "chat-translation-keyb-v1"
	maxMessageRevision        = 128
)

var ErrMessageTranslationStale = errors.New("message changed while translation was in flight")

type translationQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type storedMessageTranslation struct {
	MessageID string
	EncryptedMessageTranslation
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
	if cached.MessageRevision != revision || !validEncryptedMessageTranslation(cached) {
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
	if !validIdentifier(messageID, maxClientMessageID) {
		return "", ErrChatInvalidInput
	}
	query := `
		SELECT content_type,COALESCE(edited_at,''),created_at,deleted_at
		FROM messages WHERE id=$1 AND chat_id=$2`
	if lock {
		query += " FOR UPDATE"
	}
	var contentType, editedAt, createdAt string
	var deletedAt sql.NullString
	if err := queryer.QueryRowContext(ctx, query, messageID, chatID).Scan(
		&contentType, &editedAt, &createdAt, &deletedAt); errors.Is(err, sql.ErrNoRows) {
		return "", ErrMessageNotFound
	} else if err != nil {
		return "", err
	}
	if deletedAt.Valid {
		return "", ErrMessageNotFound
	}
	if contentType != "text" {
		return "", ErrChatInvalidInput
	}
	if editedAt != "" {
		return editedAt, nil
	}
	return createdAt, nil
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
			if stored.MessageRevision == revision && validEncryptedMessageTranslation(stored.EncryptedMessageTranslation) {
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
	if _, err := normalizeTranslationTarget(value.TargetLanguage); err != nil ||
		value.Algorithm != chatTranslationAlgorithm || value.KeyVersion != chatTranslationKeyVersion ||
		!validIdentifier(value.MessageRevision, maxMessageRevision) {
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
