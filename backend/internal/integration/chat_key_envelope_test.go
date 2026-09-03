package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestChatKeyEnvelopesAreOpaqueAndBoundToCurrentDevices(t *testing.T) {
	f := newChatAttachmentFixture(t)
	accountEnvelope := encode(bytes.Repeat([]byte{0x71}, 64))
	keyCommitment := encode(bytes.Repeat([]byte{0x70}, 32))
	payload := map[string]any{
		"envelopes": []map[string]any{
			{
				"scope": "account", "user_id": f.ownerID, "device_id": "",
				"key_version": "chat-account-v1", "public_key": "",
				"algorithm": "AES-256-GCM", "envelope": accountEnvelope, "key_commitment": keyCommitment,
			},
			{
				"scope": "device", "user_id": f.ownerID, "device_id": f.ownerDeviceID,
				"key_version": "x25519-v1", "public_key": f.ownerAgreement,
				"algorithm": "X25519-HKDF-SHA256-AES-256-GCM", "envelope": encode(bytes.Repeat([]byte{0x72}, 64)), "key_commitment": keyCommitment,
			},
			{
				"scope": "device", "user_id": f.requesterID, "device_id": f.requesterDeviceID,
				"key_version": "x25519-v1", "public_key": f.requesterAgreement,
				"algorithm": "X25519-HKDF-SHA256-AES-256-GCM", "envelope": encode(bytes.Repeat([]byte{0x73}, 64)), "key_commitment": keyCommitment,
			},
		},
	}
	if status := f.saveChatKeyEnvelopes(t, f.ownerToken, payload); status != http.StatusNoContent {
		t.Fatalf("key envelope save status = %d, want 204", status)
	}
	if status := f.saveChatKeyEnvelopes(t, f.ownerToken, payload); status != http.StatusNoContent {
		t.Fatalf("identical key envelope retry status = %d, want 204", status)
	}

	ownerStatus, ownerBundle := f.getChatKeyEnvelope(t, f.ownerToken)
	if ownerStatus != http.StatusOK {
		t.Fatalf("owner key envelope status = %d, want 200", ownerStatus)
	}
	account, ok := ownerBundle["account_envelope"].(map[string]any)
	if !ok || account["envelope"] != accountEnvelope || account["key_commitment"] != keyCommitment {
		t.Fatalf("owner account envelope = %v", ownerBundle["account_envelope"])
	}
	if _, ok := ownerBundle["device_envelope"].(map[string]any); !ok {
		t.Fatalf("owner device envelope missing: %v", ownerBundle)
	}
	if _, leaked := ownerBundle["plaintext"]; leaked {
		t.Fatal("chat key response exposed a plaintext field")
	}
	recipientStatus, recipients := f.getChatKeyRecipients(t, f.ownerToken)
	if recipientStatus != http.StatusOK || len(recipients) != 2 {
		t.Fatalf("chat key recipients = status %d, data %v; want 200 and both devices", recipientStatus, recipients)
	}
	for _, recipient := range recipients {
		if recipient["envelope_present"] != true {
			t.Fatalf("chat key recipient presence = %v, want true", recipient)
		}
		if _, leaked := recipient["envelope"]; leaked {
			t.Fatal("chat key recipient response exposed an envelope")
		}
	}

	requesterStatus, requesterBundle := f.getChatKeyEnvelope(t, f.requesterTok)
	if requesterStatus != http.StatusOK {
		t.Fatalf("requester key envelope status = %d, want 200", requesterStatus)
	}
	if _, ok := requesterBundle["account_envelope"]; ok {
		t.Fatal("requester received another user's account envelope")
	}
	if _, ok := requesterBundle["device_envelope"].(map[string]any); !ok {
		t.Fatalf("requester device envelope missing: %v", requesterBundle)
	}

	changed := map[string]any{
		"envelopes": []map[string]any{{
			"scope": "account", "user_id": f.ownerID, "device_id": "",
			"key_version": "chat-account-v1", "public_key": "", "algorithm": "AES-256-GCM",
			"envelope": encode(bytes.Repeat([]byte{0x7f}, 64)), "key_commitment": keyCommitment,
		}},
	}
	if status := f.saveChatKeyEnvelopes(t, f.ownerToken, changed); status != http.StatusConflict {
		t.Fatalf("changed key envelope status = %d, want 409", status)
	}
}

func TestChatKeyEnvelopeRejectsParticipantDevicePreemption(t *testing.T) {
	f := newChatAttachmentFixture(t)
	keyCommitment := encode(bytes.Repeat([]byte{0x60}, 32))
	attackerPayload := map[string]any{
		"envelopes": []map[string]any{{
			"scope": "device", "user_id": f.ownerID, "device_id": f.ownerDeviceID,
			"key_version": "x25519-v1", "public_key": f.ownerAgreement,
			"algorithm": "X25519-HKDF-SHA256-AES-256-GCM",
			"envelope":  encode(bytes.Repeat([]byte{0x61}, 64)), "key_commitment": keyCommitment,
		}},
	}
	if status := f.saveChatKeyEnvelopes(t, f.requesterTok, attackerPayload); status != http.StatusForbidden {
		t.Fatalf("participant device preemption status = %d, want 403", status)
	}

	ownerPayload := map[string]any{
		"envelopes": []map[string]any{
			{
				"scope": "account", "user_id": f.ownerID, "device_id": "",
				"key_version": "chat-account-v1", "public_key": "",
				"algorithm": "AES-256-GCM", "envelope": encode(bytes.Repeat([]byte{0x62}, 64)), "key_commitment": keyCommitment,
			},
			{
				"scope": "device", "user_id": f.ownerID, "device_id": f.ownerDeviceID,
				"key_version": "x25519-v1", "public_key": f.ownerAgreement,
				"algorithm": "X25519-HKDF-SHA256-AES-256-GCM", "envelope": encode(bytes.Repeat([]byte{0x63}, 64)), "key_commitment": keyCommitment,
			},
		},
	}
	if status := f.saveChatKeyEnvelopes(t, f.ownerToken, ownerPayload); status != http.StatusNoContent {
		t.Fatalf("owner initialization after rejected preemption status = %d, want 204", status)
	}

	participantPayload := map[string]any{
		"envelopes": []map[string]any{{
			"scope": "device", "user_id": f.requesterID, "device_id": f.requesterDeviceID,
			"key_version": "x25519-v1", "public_key": f.requesterAgreement,
			"algorithm": "X25519-HKDF-SHA256-AES-256-GCM",
			"envelope":  encode(bytes.Repeat([]byte{0x64}, 64)), "key_commitment": keyCommitment,
		}},
	}
	if status := f.saveChatKeyEnvelopes(t, f.requesterTok, participantPayload); status != http.StatusNoContent {
		t.Fatalf("participant own-device provisioning status = %d, want 204", status)
	}
}

func TestChatKeyEnvelopeLegacyRowsCanBeMigratedByOwner(t *testing.T) {
	f := newChatAttachmentFixture(t)
	accountEnvelope := encode(bytes.Repeat([]byte{0x81}, 64))
	ownerDeviceEnvelope := encode(bytes.Repeat([]byte{0x82}, 64))
	keyCommitment := encode(bytes.Repeat([]byte{0x83}, 32))
	stamp := f.now.UTC().Format(time.RFC3339Nano)

	// Simulate a database that has only migration 0046: the opaque rows exist,
	// but the 0047 manifest has not been created yet.
	if _, err := f.database.ExecContext(f.ctx, `
		INSERT INTO chat_key_envelopes
			(chat_id,user_id,scope,device_id,key_version,target_public_key,wrapping_algorithm,envelope,created_at,updated_at)
		VALUES ($1,$2,'account','',$3,'',$4,$5,$11,$11),
		       ($1,$2,'device',$6,$7,$8,$9,$10,$11,$11)`,
		f.chatID, f.ownerID, "chat-account-v1", "AES-256-GCM", accountEnvelope,
		f.ownerDeviceID, "x25519-v1", f.ownerAgreement, "X25519-HKDF-SHA256-AES-256-GCM", ownerDeviceEnvelope, stamp); err != nil {
		t.Fatal(err)
	}

	payload := map[string]any{
		"envelopes": []map[string]any{
			{
				"scope": "account", "user_id": f.ownerID, "device_id": "",
				"key_version": "chat-account-v1", "public_key": "",
				"algorithm": "AES-256-GCM", "envelope": accountEnvelope, "key_commitment": keyCommitment,
			},
			{
				"scope": "device", "user_id": f.ownerID, "device_id": f.ownerDeviceID,
				"key_version": "x25519-v1", "public_key": f.ownerAgreement,
				"algorithm": "X25519-HKDF-SHA256-AES-256-GCM", "envelope": ownerDeviceEnvelope, "key_commitment": keyCommitment,
			},
		},
	}
	if status := f.saveChatKeyEnvelopes(t, f.ownerToken, payload); status != http.StatusNoContent {
		t.Fatalf("legacy key envelope migration status = %d, want 204", status)
	}

	var authority, storedCommitment string
	if err := f.database.QueryRowContext(f.ctx, `
		SELECT authority_user_id,key_commitment FROM chat_key_manifests WHERE chat_id=$1`, f.chatID).
		Scan(&authority, &storedCommitment); err != nil {
		t.Fatal(err)
	}
	if authority != f.ownerID || storedCommitment != keyCommitment {
		t.Fatalf("migrated manifest = authority %q commitment %q", authority, storedCommitment)
	}
}

func (f *chatAttachmentFixture) saveChatKeyEnvelopes(t *testing.T, token string, payload map[string]any) int {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPut, f.server.URL+"/api/v1/chats/"+f.chatID+"/key-envelopes", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	f.setDeviceProof(req, token, raw)
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func (f *chatAttachmentFixture) getChatKeyEnvelope(t *testing.T, token string) (int, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, f.server.URL+"/api/v1/chats/"+f.chatID+"/key-envelope", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	f.setDeviceProof(req, token, nil)
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var response struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, response.Data
}

func (f *chatAttachmentFixture) getChatKeyRecipients(t *testing.T, token string) (int, []map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, f.server.URL+"/api/v1/chats/"+f.chatID+"/key-recipients", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	f.setDeviceProof(req, token, nil)
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var response struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, response.Data
}
