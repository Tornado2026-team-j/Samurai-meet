package integration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
)

const testAttachmentMaxBytes = 4096

type chatAttachmentFixture struct {
	server        *httptest.Server
	chatService   *chat.Service
	database      *sql.DB
	ctx           context.Context
	now           time.Time
	chatID        string
	ownerID       string
	requesterID   string
	ownerToken    string
	ownerSession  string
	requesterTok  string
	requesterSess string
	outsiderToken string
}

func newChatAttachmentFixture(t *testing.T) *chatAttachmentFixture {
	t.Helper()
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)

	ownerID := randomID(t)
	requesterID := randomID(t)
	outsiderID := randomID(t)
	for _, u := range []struct{ id, google string }{
		{ownerID, "att-owner-" + ownerID},
		{requesterID, "att-requester-" + requesterID},
		{outsiderID, "att-outsider-" + outsiderID},
	} {
		if _, err := database.ExecContext(ctx, `
			INSERT INTO users (id,google_subject_id,display_name,status,created_at,updated_at)
			VALUES ($1,$2,$3,'active',$4,$4)`, u.id, u.google, "User "+u.id[:6], stamp); err != nil {
			t.Fatal(err)
		}
	}

	cardID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,visibility_radius_km,status,expires_at,created_at,updated_at)
		VALUES ($1,$2,'Food','2026-08-27','18:00','20:00','Asia/Tokyo',3,'matched',$3,$4,$4)`,
		cardID, ownerID, now.Add(24*time.Hour).Format(time.RFC3339Nano), stamp); err != nil {
		t.Fatal(err)
	}
	matchID := randomID(t)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at)
		VALUES ($1,$2,$3,$4,'accepted',$5,$5,$5)`, matchID, cardID, requesterID, ownerID, stamp); err != nil {
		t.Fatal(err)
	}

	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x53}, 32)), "att-issuer", "att-audience")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionService(database, signer)
	store, err := image.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	chatService := chat.NewService(database, signer).WithAttachments(store, testAttachmentMaxBytes)

	session := func(userID string) auth.SessionTokens {
		tokens, tokenErr := sessions.CreateSession(ctx, userID, now)
		if tokenErr != nil {
			t.Fatal(tokenErr)
		}
		return tokens
	}
	ownerTokens := session(ownerID)
	requesterTokens := session(requesterID)
	outsiderToken := session(outsiderID).AccessToken

	summaries, err := chatService.List(ctx, ownerID, now)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("chat summaries = %d, want 1", len(summaries))
	}

	srv := httptest.NewServer(httpapi.NewRouterWithOptions(httpapi.RouterOptions{
		Environment: "test",
		Sessions:    sessions,
		Chats:       chatService,
	}))
	t.Cleanup(srv.Close)

	return &chatAttachmentFixture{
		server:        srv,
		chatService:   chatService,
		database:      database,
		ctx:           ctx,
		now:           now,
		chatID:        summaries[0].ID,
		ownerID:       ownerID,
		requesterID:   requesterID,
		ownerToken:    ownerTokens.AccessToken,
		ownerSession:  ownerTokens.SessionID,
		requesterTok:  requesterTokens.AccessToken,
		requesterSess: requesterTokens.SessionID,
		outsiderToken: outsiderToken,
	}
}

func TestChatAttachmentUploadReferenceAndDownload(t *testing.T) {
	f := newChatAttachmentFixture(t)

	ciphertext := bytes.Repeat([]byte{0x2a}, 200)
	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x07}, 12))
	digest := sha256.Sum256(ciphertext)

	status, attachment, _ := f.upload(t, f.requesterTok, ciphertext, nonce)
	if status != http.StatusCreated {
		t.Fatalf("upload status = %d, want 201", status)
	}
	if attachment["chat_id"] != f.chatID {
		t.Fatalf("attachment chat_id = %v", attachment["chat_id"])
	}
	if attachment["cipher_sha256"] != hex.EncodeToString(digest[:]) {
		t.Fatalf("cipher_sha256 = %v want %s", attachment["cipher_sha256"], hex.EncodeToString(digest[:]))
	}
	if attachment["size_bytes"].(float64) != float64(len(ciphertext)) {
		t.Fatalf("size_bytes = %v", attachment["size_bytes"])
	}
	attachmentID, _ := attachment["id"].(string)
	if attachmentID == "" {
		t.Fatal("attachment id missing")
	}

	sendStatus, sent := f.sendMessage(t, f.requesterTok, map[string]any{
		"client_message_id": "att-cmid-1",
		"ciphertext":        base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		"nonce":             base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 12)),
		"algorithm":         "AES-256-GCM",
		"key_version":       "chat-mvp-v1",
		"attachment_id":     attachmentID,
	})
	if sendStatus != http.StatusCreated {
		t.Fatalf("send status = %d, want 201", sendStatus)
	}
	sentAttachment, ok := sent["attachment"].(map[string]any)
	if !ok || sentAttachment["id"] != attachmentID {
		t.Fatalf("send response attachment = %v", sent["attachment"])
	}

	messages := f.listMessages(t, f.ownerToken)
	if len(messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(messages))
	}
	histAttachment, ok := messages[0]["attachment"].(map[string]any)
	if !ok || histAttachment["id"] != attachmentID || histAttachment["size_bytes"].(float64) != float64(len(ciphertext)) {
		t.Fatalf("history attachment = %v", messages[0]["attachment"])
	}

	for _, tok := range []string{f.ownerToken, f.requesterTok} {
		dlStatus, body, header := f.download(t, tok, attachmentID)
		if dlStatus != http.StatusOK {
			t.Fatalf("download status = %d", dlStatus)
		}
		if !bytes.Equal(body, ciphertext) {
			t.Fatalf("downloaded %d bytes, want %d identical", len(body), len(ciphertext))
		}
		if header.Get("X-Chat-Attachment-Nonce") != nonce {
			t.Fatalf("nonce header = %q", header.Get("X-Chat-Attachment-Nonce"))
		}
		if header.Get("Content-Type") != "application/octet-stream" {
			t.Fatalf("content type = %q", header.Get("Content-Type"))
		}
	}

	if dlStatus, _, _ := f.download(t, f.outsiderToken, attachmentID); dlStatus == http.StatusOK {
		t.Fatal("outsider downloaded a chat attachment")
	}
}

func TestChatAttachmentRejectsInvalidReferences(t *testing.T) {
	f := newChatAttachmentFixture(t)
	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x09}, 12))

	status, _ := f.sendMessageStatus(t, f.requesterTok, map[string]any{
		"client_message_id": "bad-ref-1",
		"ciphertext":        base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		"nonce":             base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 12)),
		"algorithm":         "AES-256-GCM",
		"key_version":       "chat-mvp-v1",
		"attachment_id":     randomID(t),
	})
	if status != http.StatusNotFound {
		t.Fatalf("unknown attachment status = %d, want 404", status)
	}

	uploadStatus, attachment, _ := f.upload(t, f.requesterTok, bytes.Repeat([]byte{0x11}, 64), nonce)
	if uploadStatus != http.StatusCreated {
		t.Fatalf("upload status = %d, want 201", uploadStatus)
	}
	status, _ = f.sendMessageStatus(t, f.ownerToken, map[string]any{
		"client_message_id": "wrong-owner-1",
		"ciphertext":        base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		"nonce":             base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 12)),
		"algorithm":         "AES-256-GCM",
		"key_version":       "chat-mvp-v1",
		"attachment_id":     attachment["id"],
	})
	if status != http.StatusNotFound {
		t.Fatalf("cross-user reference status = %d, want 404", status)
	}

	if oversized, _, _ := f.upload(t, f.requesterTok, bytes.Repeat([]byte{0x22}, testAttachmentMaxBytes+1), nonce); oversized != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized upload status = %d, want 413", oversized)
	}
}

func TestChatAttachmentBlockedAndOrphanSweep(t *testing.T) {
	f := newChatAttachmentFixture(t)
	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x09}, 12))

	_, orphan, _ := f.upload(t, f.requesterTok, bytes.Repeat([]byte{0x33}, 48), nonce)
	if err := f.chatService.ProcessExpiredAttachments(f.ctx, 0, time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("ProcessExpiredAttachments() error = %v", err)
	}
	if status, _, _ := f.download(t, f.ownerToken, orphan["id"].(string)); status == http.StatusOK {
		t.Fatal("swept orphan attachment still downloadable")
	}

	_, keep, _ := f.upload(t, f.requesterTok, bytes.Repeat([]byte{0x44}, 48), nonce)
	f.sendMessage(t, f.requesterTok, map[string]any{
		"client_message_id": "keep-1",
		"ciphertext":        base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		"nonce":             base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 12)),
		"algorithm":         "AES-256-GCM",
		"key_version":       "chat-mvp-v1",
		"attachment_id":     keep["id"],
	})
	if err := f.chatService.ProcessExpiredAttachments(f.ctx, 0, time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("ProcessExpiredAttachments() second run error = %v", err)
	}
	if status, _, _ := f.download(t, f.ownerToken, keep["id"].(string)); status != http.StatusOK {
		t.Fatalf("referenced attachment sweep-deleted, download status = %d", status)
	}

	if _, err := f.database.ExecContext(f.ctx, `INSERT INTO blocks (blocker_user_id,blocked_user_id,created_at) VALUES ($1,$2,$3)`,
		f.ownerID, f.requesterID, f.now.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	if status, _, _ := f.upload(t, f.requesterTok, bytes.Repeat([]byte{0x55}, 48), nonce); status == http.StatusCreated {
		t.Fatal("blocked user uploaded a chat attachment")
	}
	if status, _, _ := f.download(t, f.requesterTok, keep["id"].(string)); status == http.StatusOK {
		t.Fatal("blocked user downloaded a chat attachment")
	}
}

// TestChatAttachmentRetentionPurge locks that the message retention sweep also
// disposes of a linked photo: PurgeExpiredMessages tombstones the attachment row
// (download 404s at once) and the attachment sweep then deletes its blob and row.
func TestChatAttachmentRetentionPurge(t *testing.T) {
	f := newChatAttachmentFixture(t)
	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x09}, 12))

	_, attachment, _ := f.upload(t, f.requesterTok, bytes.Repeat([]byte{0x77}, 96), nonce)
	attachmentID := attachment["id"].(string)
	status, msg := f.sendMessage(t, f.requesterTok, map[string]any{
		"client_message_id": "ret-att-1",
		"ciphertext":        base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		"nonce":             base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 12)),
		"algorithm":         "AES-256-GCM",
		"key_version":       "chat-mvp-v1",
		"attachment_id":     attachmentID,
	})
	if status != http.StatusCreated {
		t.Fatalf("send status = %d", status)
	}

	f.chatService.ConfigureMessageRetention(30)
	stale := f.now.Add(-45 * 24 * time.Hour).Format(time.RFC3339Nano)
	if _, err := f.database.ExecContext(f.ctx, `UPDATE messages SET created_at=$1 WHERE id=$2`, stale, msg["id"]); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	if purged, err := f.chatService.PurgeExpiredMessages(f.ctx, f.now); err != nil || purged != 1 {
		t.Fatalf("PurgeExpiredMessages = %d, %v (want 1, nil)", purged, err)
	}

	// The attachment row is tombstoned and the download endpoint stops serving it.
	var deletedAt string
	if err := f.database.QueryRowContext(f.ctx, `SELECT COALESCE(deleted_at,'') FROM chat_attachments WHERE id=$1`, attachmentID).Scan(&deletedAt); err != nil {
		t.Fatalf("read attachment tombstone: %v", err)
	}
	if deletedAt == "" {
		t.Fatal("linked attachment not tombstoned by retention sweep")
	}
	if code, _, _ := f.download(t, f.ownerToken, attachmentID); code == http.StatusOK {
		t.Fatal("tombstoned attachment still downloadable")
	}

	// The attachment sweep deletes the blob and the row.
	if err := f.chatService.ProcessExpiredAttachments(f.ctx, 24*time.Hour, f.now.Add(time.Minute)); err != nil {
		t.Fatalf("ProcessExpiredAttachments: %v", err)
	}
	var remaining int
	if err := f.database.QueryRowContext(f.ctx, `SELECT COUNT(*) FROM chat_attachments WHERE id=$1`, attachmentID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("attachment row not removed after sweep (%d rows)", remaining)
	}
}

// --- HTTP helpers ---

func (f *chatAttachmentFixture) upload(t *testing.T, token string, ciphertext []byte, nonce string) (int, map[string]any, http.Header) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, f.server.URL+"/api/v1/chats/"+f.chatID+"/attachments", bytes.NewReader(ciphertext))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Chat-Attachment-Content-Type", "image/jpeg")
	req.Header.Set("X-Chat-Attachment-Nonce", nonce)
	req.Header.Set("X-Chat-Attachment-Algorithm", "AES-256-GCM")
	req.Header.Set("X-Chat-Attachment-Key-Version", "chat-attachment-mvp-v1")
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&envelope)
	return resp.StatusCode, envelope.Data, resp.Header
}

func (f *chatAttachmentFixture) download(t *testing.T, token, attachmentID string) (int, []byte, http.Header) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, f.server.URL+"/api/v1/chats/"+f.chatID+"/attachments/"+attachmentID, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body, resp.Header
}

func (f *chatAttachmentFixture) sendMessage(t *testing.T, token string, payload map[string]any) (int, map[string]any) {
	t.Helper()
	status, data := f.sendMessageRaw(t, token, payload)
	return status, data
}

func (f *chatAttachmentFixture) sendMessageStatus(t *testing.T, token string, payload map[string]any) (int, map[string]any) {
	t.Helper()
	return f.sendMessageRaw(t, token, payload)
}

func (f *chatAttachmentFixture) sendMessageRaw(t *testing.T, token string, payload map[string]any) (int, map[string]any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, f.server.URL+"/api/v1/chats/"+f.chatID+"/messages", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&envelope)
	return resp.StatusCode, envelope.Data
}

func (f *chatAttachmentFixture) listMessages(t *testing.T, token string) []map[string]any {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, f.server.URL+"/api/v1/chats/"+f.chatID+"/messages", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("listMessages status = %d", resp.StatusCode)
	}
	var envelope struct {
		Data struct {
			Items []map[string]any `json:"items"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data.Items
}
