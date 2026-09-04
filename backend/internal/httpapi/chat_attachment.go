package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const (
	chatAttachmentContentTypeHeader = "X-Chat-Attachment-Content-Type"
	chatAttachmentNonceHeader       = "X-Chat-Attachment-Nonce"
	chatAttachmentAlgorithmHeader   = "X-Chat-Attachment-Algorithm"
	chatAttachmentKeyVersionHeader  = "X-Chat-Attachment-Key-Version"
)

// chatAttachmentKeyRecipients returns only public X25519 agreement keys for
// the current accepted participants. A device proof is required so an access
// token copied to an unregistered device cannot enumerate recipient keys.
func chatAttachmentKeyRecipients(w http.ResponseWriter, r *http.Request, service *chat.Service, devices *keys.DeviceService, claims auth.AccessClaims, chatID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
		return
	}
	recipients, err := service.ListAttachmentKeyRecipients(r.Context(), claims.Subject, chatID)
	if err != nil {
		writeChatError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"data": recipients})
}

// chatAttachmentUpload stores one ciphertext chat photo. The request body is
// AES-256-GCM ciphertext; crypto metadata travels in headers. The server never
// receives or derives the image key.
func chatAttachmentUpload(w http.ResponseWriter, r *http.Request, service *chat.Service, devices *keys.DeviceService, claims auth.AccessClaims, chatID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !service.AttachmentsEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_attachment_unavailable"})
		return
	}
	bodyHash := strings.TrimSpace(r.Header.Get(deviceBodyHashHeader))
	if claims.AccountType != "demo" && !requireDeviceProof(w, r, devices, claims, bodyHash) {
		return
	}
	contentType := strings.TrimSpace(r.Header.Get(chatAttachmentContentTypeHeader))
	if contentType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxAttachmentBytes()+1)
	attachment, err := service.UploadAttachment(r.Context(), claims.Subject, chatID, chat.AttachmentInput{
		ContentType: contentType,
		Nonce:       r.Header.Get(chatAttachmentNonceHeader),
		Algorithm:   r.Header.Get(chatAttachmentAlgorithmHeader),
		KeyVersion:  r.Header.Get(chatAttachmentKeyVersionHeader),
		BodyHash:    bodyHash,
		Body:        r.Body,
	}, time.Now())
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "chat_attachment_too_large"})
			return
		}
		writeChatError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": attachment})
}

// chatAttachmentDownload streams the ciphertext of one attachment to a
// participant of its chat. It is never decrypted or served as an image type.
func chatAttachmentDownload(w http.ResponseWriter, r *http.Request, service *chat.Service, devices *keys.DeviceService, claims auth.AccessClaims, chatID, attachmentID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !service.AttachmentsEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_attachment_unavailable"})
		return
	}
	deviceID := strings.TrimSpace(r.Header.Get(deviceIDHeader))
	var attachment chat.Attachment
	var ciphertext []byte
	var err error
	if claims.AccountType == "demo" {
		attachment, ciphertext, err = service.OpenDemoAttachment(r.Context(), claims.Subject, chatID, attachmentID)
	} else {
		if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
			return
		}
		attachment, ciphertext, _, err = service.OpenAttachment(r.Context(), claims.Subject, chatID, attachmentID, deviceID)
	}
	if err != nil {
		writeChatError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(ciphertext)))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set(chatAttachmentNonceHeader, attachment.Nonce)
	w.Header().Set(chatAttachmentAlgorithmHeader, attachment.Algorithm)
	w.Header().Set(chatAttachmentKeyVersionHeader, attachment.KeyVersion)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ciphertext) // #nosec G705 -- application/octet-stream ciphertext, never HTML
}

// chatAttachmentEnvelope returns the opaque envelope in a private JSON
// response instead of a response header. Both this endpoint and the binary
// download require the current device proof.
func chatAttachmentEnvelope(w http.ResponseWriter, r *http.Request, service *chat.Service, devices *keys.DeviceService, claims auth.AccessClaims, chatID, attachmentID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !service.AttachmentsEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_attachment_unavailable"})
		return
	}
	if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
		return
	}
	deviceID := strings.TrimSpace(r.Header.Get(deviceIDHeader))
	attachment, envelope, err := service.OpenAttachmentEnvelope(r.Context(), claims.Subject, chatID, attachmentID, deviceID)
	if err != nil {
		writeChatError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"attachment": attachment,
			"envelope":   envelope,
		},
	})
}

// chatAttachmentKeyEnvelopes stores the complete set of opaque per-device
// envelopes for one not-yet-linked upload. The request is device-proofed over
// its exact bytes; the service validates participant/device binding but never
// decrypts the image key.
func chatAttachmentKeyEnvelopes(w http.ResponseWriter, r *http.Request, service *chat.Service, devices *keys.DeviceService, claims auth.AccessClaims, chatID, attachmentID string) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", http.MethodPut)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 512*1024))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
		return
	}
	digest := sha256.Sum256(body)
	bodyHash := base64.RawURLEncoding.EncodeToString(digest[:])
	if !requireDeviceProof(w, r, devices, claims, bodyHash) {
		return
	}
	var input struct {
		Envelopes []chat.AttachmentKeyEnvelopeInput `json:"envelopes"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
		return
	}
	if err := service.SaveAttachmentKeyEnvelopes(r.Context(), claims.Subject, chatID, attachmentID, input.Envelopes, time.Now()); err != nil {
		writeChatError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
