package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const (
	photoVisibilityHeader        = "X-Photo-Visibility"
	photoContentTypeHeader       = "X-Photo-Content-Type"
	photoNonceHeader             = "X-Photo-Nonce"
	photoAlgorithmHeader         = "X-Photo-Algorithm"
	photoKeyVersionHeader        = "X-Photo-Key-Version"
	photoDeviceIDHeader          = "X-Photo-Device-ID"
	photoWrappedKeyHeader        = "X-Photo-Wrapped-Key"
	photoAccountWrappedKeyHeader = "X-Photo-Account-Wrapped-Key"
	photoServerWrappedKeyHeader  = "X-Photo-Server-Wrapped-Key"
	photoWrappingHeader          = "X-Photo-Wrapping-Algorithm"
)

func profileWrappingKey(service *image.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		jwk, err := service.ProfilePublicKey()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "profile_wrapping_key_unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
			"key_version": service.ProfileKeyVersion(),
			"jwk":         jwk,
		}})
	}
}

func uploadPhoto(service *image.Service, sessions *auth.SessionService, devices *keys.DeviceService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		bodyHash := strings.TrimSpace(r.Header.Get(deviceBodyHashHeader))
		if !requireDeviceProof(w, r, devices, claims, bodyHash) {
			return
		}
		contentType := r.Header.Get(photoContentTypeHeader)
		if contentType == "" {
			contentType = r.Header.Get("Content-Type")
		}
		r.Body = http.MaxBytesReader(w, r.Body, service.MaxUploadBytes()+1)
		photo, err := service.Upload(r.Context(), claims.Subject, image.UploadInput{
			Visibility:        r.Header.Get(photoVisibilityHeader),
			ContentType:       contentType,
			Nonce:             r.Header.Get(photoNonceHeader),
			Algorithm:         r.Header.Get(photoAlgorithmHeader),
			KeyVersion:        r.Header.Get(photoKeyVersionHeader),
			DeviceID:          r.Header.Get(photoDeviceIDHeader),
			WrappedImageKey:   r.Header.Get(photoWrappedKeyHeader),
			AccountWrappedKey: r.Header.Get(photoAccountWrappedKeyHeader),
			ServerWrappedKey:  r.Header.Get(photoServerWrappedKeyHeader),
			WrappingAlgorithm: r.Header.Get(photoWrappingHeader),
			Body:              r.Body,
		}, time.Now())
		if err != nil {
			if errors.Is(err, image.ErrDeviceNotRegistered) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_device_proof"})
				return
			}
			if errors.Is(err, image.ErrPhotoTooLarge) || strings.Contains(err.Error(), "request body too large") {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "photo_too_large"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_encrypted_photo"})
			return
		}
		if !matchesBodyHash(photo.CipherSHA256, bodyHash) {
			_ = service.DeletePhoto(r.Context(), claims.Subject, photo.ID)
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_device_proof"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"data": photo})
	}
}

func ownedPhoto(service *image.Service, sessions *auth.SessionService, devices *keys.DeviceService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		photoID := strings.TrimPrefix(r.URL.Path, APIV1Prefix+"/me/photos/")
		if strings.HasSuffix(photoID, "/key-envelope") {
			photoID = strings.TrimSuffix(photoID, "/key-envelope")
			putPhotoKeyEnvelope(w, r, service, devices, claims, photoID)
			return
		}
		if photoID == "" || strings.Contains(photoID, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_photo_id"})
			return
		}
		if !requireDeviceProof(w, r, devices, claims, emptyBodyHash()) {
			return
		}
		switch r.Method {
		case http.MethodGet:
			photo, ciphertext, err := service.GetCiphertext(r.Context(), claims.Subject, photoID, r.Header.Get(photoDeviceIDHeader))
			if errors.Is(err, image.ErrDeviceNotRegistered) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_device_proof"})
				return
			}
			if errors.Is(err, image.ErrPhotoNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "photo_not_found"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "photo_read_failed"})
				return
			}
			writeCiphertext(w, photo, ciphertext)
		case http.MethodDelete:
			if err := service.DeletePhoto(r.Context(), claims.Subject, photoID); errors.Is(err, image.ErrPhotoNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "photo_not_found"})
				return
			} else if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "photo_delete_failed"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func publicProfilePhoto(service *image.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		photoID := strings.TrimPrefix(r.URL.Path, APIV1Prefix+"/profile-photos/")
		if photoID == "" || strings.Contains(photoID, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_photo_id"})
			return
		}
		photo, plaintext, err := service.GetPublicProfileImage(r.Context(), photoID)
		if errors.Is(err, image.ErrPhotoNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "photo_not_found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "profile_photo_read_failed"})
			return
		}
		w.Header().Set("Content-Type", photo.ContentType)
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(plaintext) // #nosec G705 -- content type is a strict raster-image allow-list; nosniff and CSP are also set
	}
}

func writeCiphertext(w http.ResponseWriter, photo image.Photo, ciphertext []byte) {
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(ciphertext)))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Photo-Nonce", photo.Nonce)
	w.Header().Set("X-Photo-Algorithm", photo.Algorithm)
	w.Header().Set("X-Photo-Key-Version", photo.KeyVersion)
	w.Header().Set("X-Photo-Wrapped-Key", photo.WrappedImageKey)
	w.Header().Set("X-Photo-Account-Wrapped-Key", photo.AccountWrappedKey)
	w.Header().Set("X-Photo-Wrapping-Algorithm", photo.WrappingAlgorithm)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ciphertext) // #nosec G705 -- this is an application/octet-stream ciphertext response, never HTML
}

func putPhotoKeyEnvelope(w http.ResponseWriter, r *http.Request, service *image.Service, devices *keys.DeviceService, claims auth.AccessClaims, photoID string) {
	if r.Method != http.MethodPut || photoID == "" || strings.Contains(photoID, "/") {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_photo_key_envelope"})
		return
	}
	digest := sha256.Sum256(body)
	bodyHash := base64.RawURLEncoding.EncodeToString(digest[:])
	if !requireDeviceProof(w, r, devices, claims, bodyHash) {
		return
	}
	var input struct {
		KeyVersion        string `json:"key_version"`
		WrappedImageKey   string `json:"wrapped_image_key"`
		WrappingAlgorithm string `json:"wrapping_algorithm"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_photo_key_envelope"})
		return
	}
	err = service.PutDeviceKeyEnvelope(r.Context(), claims.Subject, photoID, image.DeviceKeyEnvelopeInput{
		DeviceID:          r.Header.Get(photoDeviceIDHeader),
		KeyVersion:        input.KeyVersion,
		WrappedImageKey:   input.WrappedImageKey,
		WrappingAlgorithm: input.WrappingAlgorithm,
	}, now())
	if errors.Is(err, image.ErrPhotoNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "photo_not_found"})
		return
	}
	if errors.Is(err, image.ErrDeviceNotRegistered) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_device_proof"})
		return
	}
	if errors.Is(err, image.ErrInvalidPhoto) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_photo_key_envelope"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "photo_key_envelope_save_failed"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func matchesBodyHash(cipherHash, encoded string) bool {
	decoded, err := hex.DecodeString(cipherHash)
	return err == nil && base64.RawURLEncoding.EncodeToString(decoded) == encoded
}
