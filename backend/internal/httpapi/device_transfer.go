package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const deviceTransferPath = APIV1Prefix + "/me/device-transfers"

type deviceTransferCreateInput struct {
	TargetDeviceID   string `json:"target_device_id"`
	TargetKeyVersion string `json:"target_key_version"`
	TargetPublicKey  string `json:"target_public_key"`
	VerificationCode string `json:"verification_code"`
}

type deviceTransferApproveInput struct {
	VerificationCode  string `json:"verification_code"`
	WrappedMasterKey  string `json:"wrapped_master_key"`
	WrappingAlgorithm string `json:"wrapping_algorithm"`
}

func deviceTransferCollection(service *keys.DeviceTransferService, sessions *auth.SessionService, devices *keys.DeviceService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setDeviceTransferHeaders(w)
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRecentPasskey(r, sessions, claims) {
			writeRecentPasskeyRequired(w)
			return
		}
		if service == nil || devices == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "device_transfer_unavailable"})
			return
		}

		switch r.Method {
		case http.MethodGet:
			if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
				return
			}
			items, err := service.List(r.Context(), claims.Subject, now())
			if err != nil {
				writeDeviceTransferError(w, err, false)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": items})
		case http.MethodPost:
			body, err := readDeviceTransferBody(w, r, 8*1024)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_transfer_request"})
				return
			}
			var input deviceTransferCreateInput
			if json.Unmarshal(body, &input) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_transfer_request"})
				return
			}
			input.TargetDeviceID = strings.TrimSpace(input.TargetDeviceID)
			input.TargetKeyVersion = strings.TrimSpace(input.TargetKeyVersion)
			input.TargetPublicKey = strings.TrimSpace(input.TargetPublicKey)
			input.VerificationCode = strings.TrimSpace(input.VerificationCode)
			if strings.TrimSpace(r.Header.Get(deviceIDHeader)) != input.TargetDeviceID || !requireDeviceProof(w, r, devices, claims, requestBodyHash(body)) {
				return
			}
			result, err := service.Create(r.Context(), claims.Subject, input.TargetDeviceID, input.TargetKeyVersion, input.TargetPublicKey, input.VerificationCode, now())
			if err != nil {
				writeDeviceTransferError(w, err, false)
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"data": result})
		default:
			w.Header().Set("Allow", http.MethodGet+", "+http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func deviceTransferItem(service *keys.DeviceTransferService, sessions *auth.SessionService, devices *keys.DeviceService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setDeviceTransferHeaders(w)
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRecentPasskey(r, sessions, claims) {
			writeRecentPasskeyRequired(w)
			return
		}
		if service == nil || devices == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "device_transfer_unavailable"})
			return
		}
		suffix := strings.TrimPrefix(r.URL.Path, deviceTransferPath+"/")
		parts := strings.Split(suffix, "/")
		if len(parts) == 0 || parts[0] == "" || len(parts) > 2 || (len(parts) == 2 && parts[1] != "approve" && parts[1] != "complete") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_transfer_id"})
			return
		}
		transferID := parts[0]
		deviceID := strings.TrimSpace(r.Header.Get(deviceIDHeader))
		switch {
		case len(parts) == 1 && r.Method == http.MethodGet:
			if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
				return
			}
			result, err := service.GetForTarget(r.Context(), claims.Subject, transferID, deviceID, now())
			if err != nil {
				writeDeviceTransferError(w, err, true)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case len(parts) == 2 && parts[1] == "approve" && r.Method == http.MethodPost:
			body, err := readDeviceTransferBody(w, r, keys.DeviceTransferEnvelopeMax+4*1024)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_transfer_approval"})
				return
			}
			var input deviceTransferApproveInput
			if json.Unmarshal(body, &input) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_transfer_approval"})
				return
			}
			input.VerificationCode = strings.TrimSpace(input.VerificationCode)
			input.WrappedMasterKey = strings.TrimSpace(input.WrappedMasterKey)
			input.WrappingAlgorithm = strings.TrimSpace(input.WrappingAlgorithm)
			if !requireDeviceProof(w, r, devices, claims, requestBodyHash(body)) {
				return
			}
			result, err := service.Approve(r.Context(), claims.Subject, transferID, deviceID, input.VerificationCode, input.WrappedMasterKey, input.WrappingAlgorithm, now())
			if err != nil {
				writeDeviceTransferError(w, err, false)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": result})
		case len(parts) == 2 && parts[1] == "complete" && r.Method == http.MethodPost:
			if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
				return
			}
			if err := service.Complete(r.Context(), claims.Subject, transferID, deviceID, now()); err != nil {
				writeDeviceTransferError(w, err, true)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case len(parts) == 1 && r.Method == http.MethodDelete:
			if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
				return
			}
			if err := service.Cancel(r.Context(), claims.Subject, transferID, deviceID, now()); err != nil {
				writeDeviceTransferError(w, err, false)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.Header().Set("Allow", http.MethodGet+", "+http.MethodPost+", "+http.MethodDelete)
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func readDeviceTransferBody(w http.ResponseWriter, r *http.Request, maxBytes int64) ([]byte, error) {
	if r.Body == nil || r.ContentLength > maxBytes {
		return nil, errors.New("device transfer body is too large")
	}
	return io.ReadAll(http.MaxBytesReader(w, r.Body, maxBytes))
}

func requestBodyHash(body []byte) string {
	digest := sha256.Sum256(body)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func setDeviceTransferHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

func writeDeviceTransferError(w http.ResponseWriter, err error, targetRequest bool) {
	switch {
	case errors.Is(err, keys.ErrDeviceTransferRateLimited):
		w.Header().Set("Retry-After", "900")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "device_transfer_rate_limited"})
	case errors.Is(err, keys.ErrDeviceTransferCodeRateLimited):
		w.Header().Set("Retry-After", "900")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "device_transfer_verification_rate_limited"})
	case errors.Is(err, keys.ErrDeviceTransferInvalidCode):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "device_transfer_verification_failed"})
	case errors.Is(err, keys.ErrDeviceTransferNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "device_transfer_not_found"})
	case errors.Is(err, keys.ErrDeviceTransferExpired):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_transfer_expired"})
	case errors.Is(err, keys.ErrDeviceTransferNotPending):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_transfer_not_pending"})
	case errors.Is(err, keys.ErrDeviceTransferNotApproved):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_transfer_not_approved"})
	case errors.Is(err, keys.ErrDeviceTransferNotCancellable):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_transfer_not_cancellable"})
	case errors.Is(err, keys.ErrDeviceTransferTargetMismatch):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "device_transfer_target_mismatch"})
	case errors.Is(err, keys.ErrDeviceAgreementMismatch):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_agreement_key_mismatch"})
	case errors.Is(err, keys.ErrDeviceTransferAgreementMissing):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_agreement_key_required"})
	case errors.Is(err, keys.ErrInvalidWrappedMasterKey):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_wrapped_master_key"})
	case errors.Is(err, keys.ErrInvalidDeviceTransfer):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_transfer"})
	case errors.Is(err, keys.ErrDeviceNotFound):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "device_transfer_source_not_found"})
	default:
		if targetRequest {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "device_transfer_get_failed"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "device_transfer_failed"})
	}
}
