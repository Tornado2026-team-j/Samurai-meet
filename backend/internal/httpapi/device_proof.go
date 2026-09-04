package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const (
	deviceIDHeader        = "X-Photo-Device-ID"
	deviceTimestampHeader = "X-Device-Timestamp"
	deviceNonceHeader     = "X-Device-Nonce"
	deviceBodyHashHeader  = "X-Device-Body-SHA256"
	deviceSignatureHeader = "X-Device-Signature"
)

func requireDeviceProof(w http.ResponseWriter, r *http.Request, devices *keys.DeviceService, claims auth.AccessClaims, bodyHash string) bool {
	if claims.AccountType != "regular" {
		// Demo uses its own public-key table and has no normal device-proof
		// credential. Never let a non-regular session reach a regular photo,
		// attachment, chat-envelope, or device-transfer protocol.
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "demo_account_regular_api_forbidden"})
		return false
	}
	if devices == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "device_key_unavailable"})
		return false
	}
	deviceID := strings.TrimSpace(r.Header.Get(deviceIDHeader))
	timestamp := strings.TrimSpace(r.Header.Get(deviceTimestampHeader))
	nonce := strings.TrimSpace(r.Header.Get(deviceNonceHeader))
	signature := strings.TrimSpace(r.Header.Get(deviceSignatureHeader))
	if bodyHash == "" {
		bodyHash = strings.TrimSpace(r.Header.Get(deviceBodyHashHeader))
	}
	if deviceID == "" || timestamp == "" || nonce == "" || signature == "" || bodyHash == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_device_proof"})
		return false
	}
	err := devices.VerifyProof(r.Context(), claims.Subject, deviceID, r.Method, r.URL.Path, timestamp, nonce, bodyHash, signature, now())
	if err == nil {
		return true
	}
	if errors.Is(err, keys.ErrDeviceNotFound) || errors.Is(err, keys.ErrInvalidDeviceProof) || errors.Is(err, keys.ErrDeviceProofReplay) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_device_proof"})
		return false
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "device_proof_verification_failed"})
	return false
}

func emptyBodyHash() string {
	digest := sha256.Sum256(nil)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
