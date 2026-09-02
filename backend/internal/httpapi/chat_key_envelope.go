package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const maxChatKeyEnvelopeRequestBytes = 512 * 1024

func chatKeyRecipients(w http.ResponseWriter, r *http.Request, service *chat.Service, devices *keys.DeviceService, claims auth.AccessClaims, chatID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
		return
	}
	recipients, err := service.ListChatKeyRecipients(r.Context(), claims.Subject, chatID)
	if err != nil {
		writeChatError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"data": recipients})
}

// chatKeyEnvelope reads/writes opaque per-chat content-key envelopes. The
// request is device-proofed with Key-B; the agreement private key and the
// chat DEK stay on client devices.
func chatKeyEnvelope(w http.ResponseWriter, r *http.Request, service *chat.Service, devices *keys.DeviceService, claims auth.AccessClaims, chatID string) {
	deviceID := strings.TrimSpace(r.Header.Get(deviceIDHeader))
	switch r.Method {
	case http.MethodGet:
		if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
			return
		}
		bundle, err := service.GetChatKeyEnvelopes(r.Context(), claims.Subject, chatID, deviceID)
		if err != nil {
			writeChatError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		writeJSON(w, http.StatusOK, map[string]any{"data": bundle})
	case http.MethodPut:
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxChatKeyEnvelopeRequestBytes))
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
			Envelopes []chat.ChatKeyEnvelope `json:"envelopes"`
		}
		if err := json.Unmarshal(body, &input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
			return
		}
		if err := service.SaveChatKeyEnvelopes(r.Context(), claims.Subject, chatID, input.Envelopes, time.Now()); err != nil {
			writeChatError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "GET, PUT")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
