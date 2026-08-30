package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
)

const (
	chatAttachmentContentTypeHeader = "X-Chat-Attachment-Content-Type"
	chatAttachmentNonceHeader       = "X-Chat-Attachment-Nonce"
	chatAttachmentAlgorithmHeader   = "X-Chat-Attachment-Algorithm"
	chatAttachmentKeyVersionHeader  = "X-Chat-Attachment-Key-Version"
)

// chatAttachmentUpload stores one ciphertext chat photo. The request body is
// AES-256-GCM ciphertext; crypto metadata travels in headers. The server never
// receives or derives the image key.
func chatAttachmentUpload(w http.ResponseWriter, r *http.Request, service *chat.Service, userID, chatID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !service.AttachmentsEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_attachment_unavailable"})
		return
	}
	contentType := strings.TrimSpace(r.Header.Get(chatAttachmentContentTypeHeader))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxAttachmentBytes()+1)
	attachment, err := service.UploadAttachment(r.Context(), userID, chatID, chat.AttachmentInput{
		ContentType: contentType,
		Nonce:       r.Header.Get(chatAttachmentNonceHeader),
		Algorithm:   r.Header.Get(chatAttachmentAlgorithmHeader),
		KeyVersion:  r.Header.Get(chatAttachmentKeyVersionHeader),
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
func chatAttachmentDownload(w http.ResponseWriter, r *http.Request, service *chat.Service, userID, chatID, attachmentID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !service.AttachmentsEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_attachment_unavailable"})
		return
	}
	attachment, ciphertext, err := service.OpenAttachment(r.Context(), userID, chatID, attachmentID)
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
