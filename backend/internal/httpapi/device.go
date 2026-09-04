package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const devicePath = APIV1Prefix + "/me/devices"

type deviceRegistrationInput struct {
	DeviceID            string `json:"device_id"`
	KeyVersion          string `json:"key_version"`
	PublicKey           string `json:"public_key"`
	AgreementKeyVersion string `json:"agreement_key_version"`
	AgreementPublicKey  string `json:"agreement_public_key"`
}

func deviceRegistrations(service *keys.DeviceService, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRegularAccount(w, claims) {
			return
		}
		if !requireRecentPasskey(r, sessions, claims) {
			writeRecentPasskeyRequired(w)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "device_key_unavailable"})
			return
		}

		switch r.Method {
		case http.MethodGet:
			items, err := service.List(r.Context(), claims.Subject)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "device_key_list_failed"})
				return
			}
			w.Header().Set("Cache-Control", "private, no-store")
			writeJSON(w, http.StatusOK, map[string]any{"data": items})
		case http.MethodPost:
			var input deviceRegistrationInput
			if r.Body == nil || r.ContentLength > 4096 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_key_registration"})
				return
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.DeviceID) == "" || strings.TrimSpace(input.KeyVersion) == "" || strings.TrimSpace(input.PublicKey) == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_key_registration"})
				return
			}
			if err := ensureJSONBodyConsumed(decoder); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_key_registration"})
				return
			}
			input.DeviceID = strings.TrimSpace(input.DeviceID)
			input.KeyVersion = strings.TrimSpace(input.KeyVersion)
			input.PublicKey = strings.TrimSpace(input.PublicKey)
			input.AgreementKeyVersion = strings.TrimSpace(input.AgreementKeyVersion)
			input.AgreementPublicKey = strings.TrimSpace(input.AgreementPublicKey)
			if (input.AgreementKeyVersion == "") != (input.AgreementPublicKey == "") {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_agreement_registration"})
				return
			}
			var (
				device keys.Device
				err    error
			)
			if input.AgreementKeyVersion != "" {
				device, err = service.RegisterWithAgreement(r.Context(), claims.Subject, input.DeviceID, input.KeyVersion, input.PublicKey, input.AgreementKeyVersion, input.AgreementPublicKey, now())
			} else {
				device, err = service.Register(r.Context(), claims.Subject, input.DeviceID, input.KeyVersion, input.PublicKey, now())
			}
			if errors.Is(err, keys.ErrInvalidDevice) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_key_registration"})
				return
			}
			if errors.Is(err, keys.ErrDeviceKeyMismatch) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "device_key_mismatch"})
				return
			}
			if errors.Is(err, keys.ErrInvalidDeviceAgreement) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_agreement_registration"})
				return
			}
			if errors.Is(err, keys.ErrDeviceAgreementMismatch) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "device_agreement_key_mismatch"})
				return
			}
			if errors.Is(err, keys.ErrDeviceNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "device_key_registration_not_found"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "device_key_registration_failed"})
				return
			}
			w.Header().Set("Cache-Control", "private, no-store")
			writeJSON(w, http.StatusOK, map[string]any{"data": device})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}
