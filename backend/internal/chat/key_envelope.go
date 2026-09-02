package chat

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

const (
	chatAccountKeyEnvelopeVersion = "chat-account-v1"
	chatDeviceKeyEnvelopeVersion  = "x25519-v1"
	chatAccountKeyAlgorithm       = "AES-256-GCM"
	chatDeviceKeyAlgorithm        = "X25519-HKDF-SHA256-AES-256-GCM"
	maxChatKeyEnvelopeBytes       = 16 * 1024
	maxChatKeyEnvelopeInputs      = 64
)

var (
	ErrChatKeyEnvelopeConflict = errors.New("chat key envelope already exists with different contents")
	ErrChatKeyEnvelopeMissing  = errors.New("chat key envelope is missing")
)

// ChatKeyEnvelope is an opaque client-created envelope. The server validates
// only its public routing metadata and never opens Envelope.
type ChatKeyEnvelope struct {
	Scope             string `json:"scope"`
	UserID            string `json:"user_id"`
	DeviceID          string `json:"device_id"`
	KeyVersion        string `json:"key_version"`
	PublicKey         string `json:"public_key"`
	WrappingAlgorithm string `json:"algorithm"`
	Envelope          string `json:"envelope"`
}

// ChatKeyEnvelopeBundle contains the current user's account envelope and the
// envelope addressed to the current device, when either has been provisioned.
type ChatKeyEnvelopeBundle struct {
	AccountEnvelope *ChatKeyEnvelope `json:"account_envelope,omitempty"`
	DeviceEnvelope  *ChatKeyEnvelope `json:"device_envelope,omitempty"`
}

// ChatKeyRecipient exposes only the public agreement key and whether this
// chat already has an envelope for that device. The presence bit lets an
// existing key holder add a newly registered device without replacing any
// immutable envelope.
type ChatKeyRecipient struct {
	UserID          string `json:"user_id"`
	DeviceID        string `json:"device_id"`
	KeyVersion      string `json:"key_version"`
	PublicKey       string `json:"public_key"`
	EnvelopePresent bool   `json:"envelope_present"`
}

// ListChatKeyRecipients returns public X25519 metadata for both participants
// and the current chat's device-envelope presence. It never returns an
// envelope payload or account-key metadata.
func (s *Service) ListChatKeyRecipients(ctx context.Context, userID, chatID string) ([]ChatKeyRecipient, error) {
	if s == nil || s.db == nil || !validIdentifier(userID, maxClientMessageID) || !validIdentifier(chatID, maxClientMessageID) {
		return nil, ErrChatInvalidInput
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT d.user_id,d.device_id,COALESCE(d.agreement_key_version,''),COALESCE(d.agreement_public_key,''),
		       EXISTS(
			       SELECT 1 FROM chat_key_envelopes e
			       WHERE e.chat_id=$3 AND e.user_id=d.user_id AND e.scope='device' AND e.device_id=d.device_id
		       )
		FROM devices d
		WHERE d.user_id=$1 OR d.user_id=$2
		ORDER BY d.user_id,d.device_id`, access.OwnerUserID, access.RequesterID, access.ChatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]ChatKeyRecipient, 0)
	for rows.Next() {
		var recipient ChatKeyRecipient
		if err := rows.Scan(&recipient.UserID, &recipient.DeviceID, &recipient.KeyVersion, &recipient.PublicKey, &recipient.EnvelopePresent); err != nil {
			return nil, err
		}
		if recipient.KeyVersion != chatDeviceKeyEnvelopeVersion || !validX25519PublicKey(recipient.PublicKey) {
			return nil, ErrChatKeyEnvelopeMissing
		}
		result = append(result, recipient)
		if len(result) > maxChatKeyEnvelopeInputs {
			return nil, ErrChatKeyEnvelopeMissing
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(result) == 0 {
		return nil, ErrChatKeyEnvelopeMissing
	}
	return result, nil
}

// GetChatKeyEnvelopes returns only envelopes addressed to the authenticated
// user/current device. A device proof is enforced by the HTTP boundary.
func (s *Service) GetChatKeyEnvelopes(ctx context.Context, userID, chatID, deviceID string) (ChatKeyEnvelopeBundle, error) {
	if s == nil || s.db == nil || !validIdentifier(userID, maxClientMessageID) || !validIdentifier(chatID, maxClientMessageID) || !validIdentifier(deviceID, maxClientMessageID) {
		return ChatKeyEnvelopeBundle{}, ErrChatInvalidInput
	}
	if _, err := s.loadChat(ctx, userID, chatID, true); err != nil {
		return ChatKeyEnvelopeBundle{}, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT scope,user_id,device_id,key_version,target_public_key,wrapping_algorithm,envelope
		FROM chat_key_envelopes
		WHERE chat_id=$1 AND user_id=$2 AND (
			(scope='account' AND device_id='') OR
			(scope='device' AND device_id=$3)
		)`, chatID, userID, deviceID)
	if err != nil {
		return ChatKeyEnvelopeBundle{}, err
	}
	defer rows.Close()
	var result ChatKeyEnvelopeBundle
	for rows.Next() {
		var item ChatKeyEnvelope
		if err := rows.Scan(&item.Scope, &item.UserID, &item.DeviceID, &item.KeyVersion, &item.PublicKey, &item.WrappingAlgorithm, &item.Envelope); err != nil {
			return ChatKeyEnvelopeBundle{}, err
		}
		if err := validateStoredChatKeyEnvelope(item); err != nil {
			continue
		}
		switch item.Scope {
		case "account":
			copy := item
			result.AccountEnvelope = &copy
		case "device":
			copy := item
			result.DeviceEnvelope = &copy
		}
	}
	if err := rows.Err(); err != nil {
		return ChatKeyEnvelopeBundle{}, err
	}
	return result, nil
}

// SaveChatKeyEnvelopes stores immutable account/device envelopes. A caller may
// add a newly registered device later, but cannot replace an existing opaque
// envelope with a different value.
func (s *Service) SaveChatKeyEnvelopes(ctx context.Context, userID, chatID string, inputs []ChatKeyEnvelope, now time.Time) error {
	if s == nil || s.db == nil || !validIdentifier(userID, maxClientMessageID) || !validIdentifier(chatID, maxClientMessageID) || len(inputs) == 0 || len(inputs) > maxChatKeyEnvelopeInputs {
		return ErrChatInvalidInput
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return err
	}
	expectedByID := make(map[string]AttachmentKeyRecipient)
	needsDeviceRecipients := false
	for _, input := range inputs {
		if strings.TrimSpace(input.Scope) == "device" {
			needsDeviceRecipients = true
			break
		}
	}
	if needsDeviceRecipients {
		expected, recipientErr := attachmentKeyRecipients(ctx, s.db, access)
		if recipientErr != nil {
			return recipientErr
		}
		expectedByID = make(map[string]AttachmentKeyRecipient, len(expected))
		for _, recipient := range expected {
			expectedByID[attachmentRecipientKey(recipient.UserID, recipient.DeviceID)] = recipient
		}
	}

	validated := make(map[string]ChatKeyEnvelope, len(inputs))
	for _, raw := range inputs {
		input := normalizeChatKeyEnvelope(raw)
		if err := validateChatKeyEnvelopeInput(input, userID, expectedByID); err != nil {
			return err
		}
		key := chatKeyEnvelopeRowKey(input)
		if _, exists := validated[key]; exists {
			return ErrChatInvalidInput
		}
		validated[key] = input
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stamp := now.UTC().Format(time.RFC3339Nano)
	for _, input := range validated {
		var stored ChatKeyEnvelope
		err = tx.QueryRowContext(ctx, `
			SELECT scope,user_id,device_id,key_version,target_public_key,wrapping_algorithm,envelope
			FROM chat_key_envelopes
			WHERE chat_id=$1 AND user_id=$2 AND scope=$3 AND device_id=$4
			FOR UPDATE`, access.ChatID, input.UserID, input.Scope, input.DeviceID).
			Scan(&stored.Scope, &stored.UserID, &stored.DeviceID, &stored.KeyVersion, &stored.PublicKey, &stored.WrappingAlgorithm, &stored.Envelope)
		if errors.Is(err, sql.ErrNoRows) {
			if _, err = tx.ExecContext(ctx, `
				INSERT INTO chat_key_envelopes
					(chat_id,user_id,scope,device_id,key_version,target_public_key,wrapping_algorithm,envelope,created_at,updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
				access.ChatID, input.UserID, input.Scope, input.DeviceID, input.KeyVersion, input.PublicKey,
				input.WrappingAlgorithm, input.Envelope, stamp); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if stored != input {
			return ErrChatKeyEnvelopeConflict
		}
	}
	return tx.Commit()
}

func normalizeChatKeyEnvelope(input ChatKeyEnvelope) ChatKeyEnvelope {
	input.Scope = strings.TrimSpace(input.Scope)
	input.UserID = strings.TrimSpace(input.UserID)
	input.DeviceID = strings.TrimSpace(input.DeviceID)
	input.KeyVersion = strings.TrimSpace(input.KeyVersion)
	input.PublicKey = strings.TrimSpace(input.PublicKey)
	input.WrappingAlgorithm = strings.TrimSpace(input.WrappingAlgorithm)
	input.Envelope = strings.TrimSpace(input.Envelope)
	return input
}

func validateChatKeyEnvelopeInput(input ChatKeyEnvelope, callerUserID string, expected map[string]AttachmentKeyRecipient) error {
	if !validIdentifier(input.UserID, maxClientMessageID) || input.Envelope == "" || len(input.Envelope) > maxChatKeyEnvelopeBytes || !validOpaqueChatKeyEnvelope(input.Envelope) {
		return ErrChatInvalidInput
	}
	if input.Scope == "account" {
		if input.UserID != callerUserID || input.DeviceID != "" || input.KeyVersion != chatAccountKeyEnvelopeVersion || input.PublicKey != "" || input.WrappingAlgorithm != chatAccountKeyAlgorithm {
			return ErrChatInvalidInput
		}
		return nil
	}
	if input.Scope != "device" || !validIdentifier(input.DeviceID, maxClientMessageID) || input.KeyVersion != chatDeviceKeyEnvelopeVersion || input.WrappingAlgorithm != chatDeviceKeyAlgorithm || !validX25519PublicKey(input.PublicKey) {
		return ErrChatInvalidInput
	}
	recipient, ok := expected[attachmentRecipientKey(input.UserID, input.DeviceID)]
	if !ok || recipient.KeyVersion != input.KeyVersion || recipient.PublicKey != input.PublicKey {
		return ErrChatKeyEnvelopeMissing
	}
	return nil
}

func validateStoredChatKeyEnvelope(input ChatKeyEnvelope) error {
	return validateChatKeyEnvelopeInput(input, input.UserID, map[string]AttachmentKeyRecipient{
		attachmentRecipientKey(input.UserID, input.DeviceID): {
			UserID: input.UserID, DeviceID: input.DeviceID, KeyVersion: input.KeyVersion, PublicKey: input.PublicKey,
		},
	})
}

func validOpaqueChatKeyEnvelope(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) >= 32 && len(decoded) <= maxChatKeyEnvelopeBytes
}

func chatKeyEnvelopeRowKey(input ChatKeyEnvelope) string {
	return input.Scope + "\x00" + input.UserID + "\x00" + input.DeviceID
}
