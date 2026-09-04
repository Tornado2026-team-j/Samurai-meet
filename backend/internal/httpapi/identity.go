package httpapi

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/identity"
)

const identitySessionPath = APIV1Prefix + "/identity/session"
const identityWebhookPath = APIV1Prefix + "/identity/webhook"

func createIdentitySession(service *identity.Service, sessions *auth.SessionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := accessClaims(r, sessions)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_or_invalid_access_token"})
			return
		}
		if !requireRegularAccount(w, claims) {
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		result, err := service.CreateSession(r.Context(), claims.Subject, time.Now())
		if err != nil {
			status := http.StatusBadGateway
			if errors.Is(err, identity.ErrUnavailable) {
				status = http.StatusServiceUnavailable
			}
			writeJSON(w, status, map[string]string{"error": "identity_verification_unavailable"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"data": result})
	}
}

func identityWebhook(service *identity.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 256*1024))
		if err != nil || service.HandleWebhook(r.Context(), r.Header.Get("Stripe-Signature"), body, time.Now()) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_identity_webhook"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
