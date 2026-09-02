package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func TestChatKeyEnvelopesAreOpaqueAndBoundToCurrentDevices(t *testing.T) {
	f := newChatAttachmentFixture(t)
	accountEnvelope := encode(bytes.Repeat([]byte{0x71}, 64))
	payload := map[string]any{
		"envelopes": []map[string]any{
			{
				"scope": "account", "user_id": f.ownerID, "device_id": "",
				"key_version": "chat-account-v1", "public_key": "",
				"algorithm": "AES-256-GCM", "envelope": accountEnvelope,
			},
			{
				"scope": "device", "user_id": f.ownerID, "device_id": f.ownerDeviceID,
				"key_version": "x25519-v1", "public_key": f.ownerAgreement,
				"algorithm": "X25519-HKDF-SHA256-AES-256-GCM", "envelope": encode(bytes.Repeat([]byte{0x72}, 64)),
			},
			{
				"scope": "device", "user_id": f.requesterID, "device_id": f.requesterDeviceID,
				"key_version": "x25519-v1", "public_key": f.requesterAgreement,
				"algorithm": "X25519-HKDF-SHA256-AES-256-GCM", "envelope": encode(bytes.Repeat([]byte{0x73}, 64)),
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
	if !ok || account["envelope"] != accountEnvelope {
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
			"envelope": encode(bytes.Repeat([]byte{0x7f}, 64)),
		}},
	}
	if status := f.saveChatKeyEnvelopes(t, f.ownerToken, changed); status != http.StatusConflict {
		t.Fatalf("changed key envelope status = %d, want 409", status)
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
