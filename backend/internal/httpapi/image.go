package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
)

const (
	photoVisibilityHeader       = "X-Photo-Visibility"
	photoContentTypeHeader      = "X-Photo-Content-Type"
	photoNonceHeader            = "X-Photo-Nonce"
	photoAlgorithmHeader        = "X-Photo-Algorithm"
	photoKeyVersionHeader       = "X-Photo-Key-Version"
	photoWrappedKeyHeader       = "X-Photo-Wrapped-Key"
	photoServerWrappedKeyHeader = "X-Photo-Server-Wrapped-Key"
	photoWrappingHeader         = "X-Photo-Wrapping-Algorithm"
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

func uploadPhoto(service *image.Service, sessions *auth.SessionService) http.HandlerFunc {
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
			WrappedImageKey:   r.Header.Get(photoWrappedKeyHeader),
			ServerWrappedKey:  r.Header.Get(photoServerWrappedKeyHeader),
			WrappingAlgorithm: r.Header.Get(photoWrappingHeader),
			Body:              r.Body,
		}, time.Now())
		if err != nil {
			if errors.Is(err, image.ErrPhotoTooLarge) || strings.Contains(err.Error(), "request body too large") {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "photo_too_large"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_encrypted_photo"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"data": photo})
	}
}

func ownedPhoto(service *image.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		photoID := strings.TrimPrefix(r.URL.Path, APIV1Prefix+"/me/photos/")
		if photoID == "" || strings.Contains(photoID, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_photo_id"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			photo, ciphertext, err := service.GetCiphertext(r.Context(), claims.Subject, photoID)
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
	w.Header().Set("X-Photo-Wrapping-Algorithm", photo.WrappingAlgorithm)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ciphertext) // #nosec G705 -- this is an application/octet-stream ciphertext response, never HTML
}
