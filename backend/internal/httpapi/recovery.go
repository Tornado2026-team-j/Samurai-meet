package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

const recoveryPath = APIV1Prefix + "/auth/recovery"

func recoveryChallenge(service *keys.RecoveryService, sessions *auth.SessionService, preauth *auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setRecoveryHeaders(w)
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "recovery_unavailable"})
			return
		}

		if sessions != nil {
			if claims, ok := accessClaims(r, sessions); ok {
				if !requireRecentPasskey(r, sessions, claims) {
					writeRecentPasskeyRequired(w)
					return
				}
				result, err := service.BeginForSession(r.Context(), claims.Subject, claims.SessionID, now())
				writeRecoveryChallengeResult(w, result, err)
				return
			}
		}
		if preauth == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		token := authorizationToken(r)
		result, err := service.BeginForPreAuth(r.Context(), token, now())
		writeRecoveryChallengeResult(w, result, err)
	}
}

func recoveryVerify(service *keys.RecoveryService, sessions *auth.SessionService, preauth *auth.PreAuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setRecoveryHeaders(w)
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if service == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "recovery_unavailable"})
			return
		}
		var input keys.RecoveryProof
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
		if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.ChallengeID) == "" || strings.TrimSpace(input.Challenge) == "" || strings.TrimSpace(input.KeyVersion) == "" || strings.TrimSpace(input.Signature) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recovery_proof"})
			return
		}
		if err := ensureJSONBodyConsumed(decoder); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_recovery_proof"})
			return
		}

		if sessions != nil {
			if claims, ok := accessClaims(r, sessions); ok {
				if !requireRecentPasskey(r, sessions, claims) {
					writeRecentPasskeyRequired(w)
					return
				}
				if err := service.VerifyForSession(r.Context(), claims.Subject, claims.SessionID, input, now()); err != nil {
					writeRecoveryVerifyError(w, err)
					return
				}
				writeJSON(w, http.StatusOK, map[string]string{"status": "recovered"})
				return
			}
		}
		if preauth == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		result, err := service.VerifyForPreAuth(r.Context(), authorizationToken(r), input, now())
		if err != nil {
			writeRecoveryVerifyError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func writeRecoveryChallengeResult(w http.ResponseWriter, result keys.RecoveryChallenge, err error) {
	if errors.Is(err, keys.ErrRecoveryRateLimited) {
		w.Header().Set("Retry-After", "3600")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "recovery_rate_limited"})
		return
	}
	if errors.Is(err, keys.ErrRecoveryUnavailable) {
		// The account exists; only the optional recovery material has not been
		// configured. Do not make the client treat this as a missing endpoint.
		writeJSON(w, http.StatusConflict, map[string]string{"error": "recovery_not_configured"})
		return
	}
	if errors.Is(err, keys.ErrRecoveryChallenge) || errors.Is(err, auth.ErrPreAuth) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "recovery_challenge_failed"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "recovery_challenge_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

func writeRecoveryVerifyError(w http.ResponseWriter, err error) {
	if errors.Is(err, keys.ErrRecoveryRateLimited) {
		w.Header().Set("Retry-After", "3600")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "recovery_rate_limited"})
		return
	}
	if errors.Is(err, keys.ErrRecoveryChallenge) || errors.Is(err, keys.ErrRecoveryProof) || errors.Is(err, auth.ErrPreAuth) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "recovery_verification_failed"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "recovery_verification_failed"})
}

func setRecoveryHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}
