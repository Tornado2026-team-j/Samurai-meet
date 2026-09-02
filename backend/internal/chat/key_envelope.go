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
	ErrChatKeyEnvelopeConflict  = errors.New("chat key envelope already exists with different contents")
	ErrChatKeyEnvelopeMissing   = errors.New("chat key envelope is missing")
	ErrChatKeyEnvelopeAuthority = errors.New("chat key envelope authority is required")
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
	KeyCommitment     string `json:"key_commitment"`
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
			SELECT e.scope,e.user_id,e.device_id,e.key_version,e.target_public_key,e.wrapping_algorithm,e.envelope,
			       COALESCE(m.key_commitment,'')
			FROM chat_key_envelopes e
			LEFT JOIN chat_key_manifests m ON m.chat_id=e.chat_id
			WHERE e.chat_id=$1 AND e.user_id=$2 AND (
				(e.scope='account' AND e.device_id='') OR
				(e.scope='device' AND e.device_id=$3)
			)`, chatID, userID, deviceID)
	if err != nil {
		return ChatKeyEnvelopeBundle{}, err
	}
	defer rows.Close()
	var result ChatKeyEnvelopeBundle
	for rows.Next() {
		var item ChatKeyEnvelope
		if err := rows.Scan(&item.Scope, &item.UserID, &item.DeviceID, &item.KeyVersion, &item.PublicKey, &item.WrappingAlgorithm, &item.Envelope, &item.KeyCommitment); err != nil {
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

// SaveChatKeyEnvelopes stores immutable account/device envelopes. The match
// owner may provision every participant device; another participant may only
// provision devices belonging to that same participant. A caller may add a
// newly registered device later, but cannot replace an existing opaque
// envelope with a different value.
func (s *Service) SaveChatKeyEnvelopes(ctx context.Context, userID, callerDeviceID, chatID string, inputs []ChatKeyEnvelope, now time.Time) error {
	if s == nil || s.db == nil || !validIdentifier(userID, maxClientMessageID) || !validIdentifier(callerDeviceID, maxClientMessageID) || !validIdentifier(chatID, maxClientMessageID) || len(inputs) == 0 || len(inputs) > maxChatKeyEnvelopeInputs {
		return ErrChatInvalidInput
	}
	access, err := s.loadChat(ctx, userID, chatID, true)
	if err != nil {
		return err
	}
	var callerDeviceExists bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM devices WHERE user_id=$1 AND device_id=$2)`, userID, callerDeviceID).Scan(&callerDeviceExists); err != nil {
		return err
	}
	if !callerDeviceExists {
		return ErrChatKeyEnvelopeAuthority
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
		// The owner may provision both participants' devices. A normal
		// participant may only provision its own account's devices, so it cannot
		// occupy the other participant's immutable row with an opaque envelope.
		if userID != access.OwnerUserID {
			for _, raw := range inputs {
				input := normalizeChatKeyEnvelope(raw)
				if input.Scope == "device" && input.UserID != userID {
					return ErrChatKeyEnvelopeAuthority
				}
			}
		}
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
		if !validChatKeyCommitment(input.KeyCommitment) {
			return ErrChatInvalidInput
		}
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
	var lockedChatID string
	if err = tx.QueryRowContext(ctx, `SELECT id FROM chat_threads WHERE id=$1 FOR UPDATE`, access.ChatID).Scan(&lockedChatID); err != nil {
		return err
	}
	stamp := now.UTC().Format(time.RFC3339Nano)

	existingRows, err := tx.QueryContext(ctx, `
		SELECT scope,user_id,device_id,key_version,target_public_key,wrapping_algorithm,envelope
		FROM chat_key_envelopes WHERE chat_id=$1 FOR UPDATE`, access.ChatID)
	if err != nil {
		return err
	}
	existing := make(map[string]ChatKeyEnvelope)
	for existingRows.Next() {
		var stored ChatKeyEnvelope
		if err := existingRows.Scan(&stored.Scope, &stored.UserID, &stored.DeviceID, &stored.KeyVersion, &stored.PublicKey, &stored.WrappingAlgorithm, &stored.Envelope); err != nil {
			_ = existingRows.Close()
			return err
		}
		existing[chatKeyEnvelopeRowKey(stored)] = stored
	}
	if err := existingRows.Close(); err != nil {
		return err
	}

	var manifestAuthority, manifestCommitment string
	manifestErr := tx.QueryRowContext(ctx, `
		SELECT authority_user_id,key_commitment
		FROM chat_key_manifests WHERE chat_id=$1 FOR UPDATE`, access.ChatID).
		Scan(&manifestAuthority, &manifestCommitment)
	if !errors.Is(manifestErr, sql.ErrNoRows) && manifestErr != nil {
		return manifestErr
	}
	if manifestErr == nil {
		if manifestAuthority != access.OwnerUserID || !validChatKeyCommitment(manifestCommitment) {
			return ErrChatKeyEnvelopeAuthority
		}
		for _, input := range validated {
			if input.KeyCommitment != manifestCommitment {
				return ErrChatKeyEnvelopeConflict
			}
		}
	} else {
		// A manifest is created only by the canonical owner. This also
		// upgrades an old 0046-only chat without trusting a participant's
		// first opaque device envelope.
		if userID != access.OwnerUserID {
			return ErrChatKeyEnvelopeAuthority
		}
		for _, input := range validated {
			if manifestCommitment == "" {
				manifestCommitment = input.KeyCommitment
			} else if input.KeyCommitment != manifestCommitment {
				return ErrChatKeyEnvelopeConflict
			}
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO chat_key_manifests (chat_id,authority_user_id,key_commitment,created_at,updated_at)
			VALUES ($1,$2,$3,$4,$4)`, access.ChatID, access.OwnerUserID, manifestCommitment, stamp); err != nil {
			return err
		}
	}

	for _, input := range validated {
		stored, exists := existing[chatKeyEnvelopeRowKey(input)]
		if !exists {
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
		if !chatKeyEnvelopeEquivalent(stored, input) {
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
	input.KeyCommitment = strings.TrimSpace(input.KeyCommitment)
	return input
}

func validateChatKeyEnvelopeInput(input ChatKeyEnvelope, callerUserID string, expected map[string]AttachmentKeyRecipient) error {
	if !validChatKeyCommitment(input.KeyCommitment) {
		return ErrChatInvalidInput
	}
	return validateChatKeyEnvelopeMetadata(input, callerUserID, expected)
}

func validateChatKeyEnvelopeMetadata(input ChatKeyEnvelope, callerUserID string, expected map[string]AttachmentKeyRecipient) error {
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
	if input.KeyCommitment != "" && !validChatKeyCommitment(input.KeyCommitment) {
		return ErrChatInvalidInput
	}
	return validateChatKeyEnvelopeMetadata(input, input.UserID, map[string]AttachmentKeyRecipient{
		attachmentRecipientKey(input.UserID, input.DeviceID): {
			UserID: input.UserID, DeviceID: input.DeviceID, KeyVersion: input.KeyVersion, PublicKey: input.PublicKey,
		},
	})
}

func validChatKeyCommitment(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == 32
}

func chatKeyEnvelopeEquivalent(left, right ChatKeyEnvelope) bool {
	return left.Scope == right.Scope && left.UserID == right.UserID && left.DeviceID == right.DeviceID &&
		left.KeyVersion == right.KeyVersion && left.PublicKey == right.PublicKey &&
		left.WrappingAlgorithm == right.WrappingAlgorithm && left.Envelope == right.Envelope
}

func validOpaqueChatKeyEnvelope(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) >= 32 && len(decoded) <= maxChatKeyEnvelopeBytes
}

func chatKeyEnvelopeRowKey(input ChatKeyEnvelope) string {
	return input.Scope + "\x00" + input.UserID + "\x00" + input.DeviceID
}
