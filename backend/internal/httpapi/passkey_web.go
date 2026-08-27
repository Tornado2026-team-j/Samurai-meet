package httpapi

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

const webPasskeyBootstrapHeader = "X-Web-Passkey-Token" // #nosec G101 -- protocol header name, not a credential

func prepareSensitiveAuthResponse(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

func prepareWebPasskeyResponse(w http.ResponseWriter) {
	prepareSensitiveAuthResponse(w)
}

func passkeyWebOptions(passkeys *auth.PasskeyService, bootstraps *auth.PasskeyBootstrapService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareWebPasskeyResponse(w)
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		token := strings.TrimSpace(r.Header.Get(webPasskeyBootstrapHeader))
		if token == "" || passkeys == nil || bootstraps == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		bootstrap, err := bootstraps.LookupAny(r.Context(), token, time.Now())
		if err != nil || bootstrap.CeremonyTokenHash != "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		var result auth.PasskeyOptions
		switch bootstrap.Scope {
		case auth.PasskeyBootstrapRegister:
			if bootstrap.SourcePreAuthHash != "" {
				result, err = passkeys.BeginRegistrationForPreAuth(r.Context(), bootstrap.UserID, time.Now())
			} else {
				result, err = passkeys.BeginRegistration(r.Context(), bootstrap.UserID, time.Now())
			}
		case auth.PasskeyBootstrapLogin:
			result, err = passkeys.BeginLogin(r.Context(), bootstrap.UserID, time.Now())
		case auth.PasskeyBootstrapReauth:
			result, err = passkeys.BeginReauth(r.Context(), bootstrap.UserID, time.Now())
		default:
			err = auth.ErrPasskeyBootstrap
		}
		if err != nil || result.CeremonyToken == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_options_failed"})
			return
		}
		if err = bootstraps.BindCeremony(r.Context(), token, bootstrap.Scope, bootstrap.UserID, bootstrap.SessionID, result.CeremonyToken, time.Now()); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": result})
	}
}

func passkeyWebReset(bootstraps *auth.PasskeyBootstrapService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareWebPasskeyResponse(w)
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		bootstrapToken := strings.TrimSpace(r.Header.Get(webPasskeyBootstrapHeader))
		ceremonyToken := strings.TrimSpace(r.Header.Get(passkeyCeremonyHTTPHeader))
		if bootstrapToken == "" || ceremonyToken == "" || bootstraps == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		bootstrap, err := bootstraps.LookupAny(r.Context(), bootstrapToken, time.Now())
		if err != nil || bootstrap.CeremonyTokenHash == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		if err = bootstraps.ResetCeremony(r.Context(), bootstrapToken, bootstrap.Scope, bootstrap.UserID, bootstrap.SessionID, ceremonyToken, time.Now()); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "passkey_ceremony_reset_unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]bool{"reset": true}})
	}
}

func passkeyWebVerify(passkeys *auth.PasskeyService, bootstraps *auth.PasskeyBootstrapService, preauth *auth.PreAuthService, sessions *auth.SessionService, handoffs *auth.SessionHandoffService, environments ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prepareWebPasskeyResponse(w)
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		bootstrapToken := strings.TrimSpace(r.Header.Get(webPasskeyBootstrapHeader))
		ceremonyToken := strings.TrimSpace(r.Header.Get(passkeyCeremonyHTTPHeader))
		if bootstrapToken == "" || ceremonyToken == "" || passkeys == nil || bootstraps == nil || sessions == nil || handoffs == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		bootstrap, err := bootstraps.LookupAny(r.Context(), bootstrapToken, time.Now())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		if err = bootstraps.ValidateCeremony(r.Context(), bootstrapToken, bootstrap.Scope, bootstrap.UserID, bootstrap.SessionID, ceremonyToken, time.Now()); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_ceremony"})
			return
		}
		if bootstrap.SourcePreAuthHash != "" && preauth == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		if r.Body == nil || r.ContentLength > 128<<10 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_passkey_response"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 128<<10)

		var sessionID string
		nowAt := time.Now()
		switch bootstrap.Scope {
		case auth.PasskeyBootstrapRegister:
			var tokens auth.SessionTokens
			if bootstrap.SourcePreAuthHash != "" {
				tokens, err = passkeys.FinishRegistrationWithPreAuthHash(r.Context(), bootstrap.UserID, ceremonyToken, r, nowAt, bootstrap.SourcePreAuthHash)
				if err == nil {
					sessionID = tokens.SessionID
				}
			} else {
				err = passkeys.FinishRegistrationForSession(r.Context(), bootstrap.UserID, bootstrap.SessionID, ceremonyToken, r, nowAt)
				if err == nil {
					sessionID = bootstrap.SessionID
				}
			}
		case auth.PasskeyBootstrapLogin:
			var tokens auth.SessionTokens
			if bootstrap.SourcePreAuthHash != "" {
				tokens, err = passkeys.FinishLoginWithPreAuthHash(r.Context(), ceremonyToken, r, nowAt, bootstrap.SourcePreAuthHash, bootstrap.UserID)
			} else {
				tokens, err = passkeys.FinishLogin(r.Context(), ceremonyToken, r, nowAt, "", bootstrap.UserID)
			}
			if err == nil {
				sessionID = tokens.SessionID
			}
		case auth.PasskeyBootstrapReauth:
			err = passkeys.FinishReauth(r.Context(), bootstrap.UserID, bootstrap.SessionID, ceremonyToken, r, nowAt)
			sessionID = bootstrap.SessionID
		default:
			err = auth.ErrPasskeyBootstrap
		}
		if err != nil || sessionID == "" {
			if err != nil && len(environments) > 0 && strings.EqualFold(strings.TrimSpace(environments[0]), "development") {
				// Keep the client response generic. This local-only diagnostic
				// contains no token, credential, or key material.
				log.Printf("passkey web verification failed: scope=%s reason=%v", bootstrap.Scope, err)
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "passkey_verification_failed"})
			return
		}
		// ConsumeWithSourceSession validates the session that originally issued
		// the bootstrap. A pre-auth bootstrap deliberately has no source session;
		// the sessionID above is the newly-created result and is only used for the
		// handoff below.
		if err = bootstraps.ConsumeWithSourceSession(r.Context(), bootstrapToken, bootstrap.Scope, bootstrap.UserID, bootstrap.SessionID, ceremonyToken, time.Now()); err != nil {
			if bootstrap.SourcePreAuthHash != "" && sessionID != "" {
				_ = sessions.RevokeOwnedSession(r.Context(), bootstrap.UserID, sessionID, "passkey_bootstrap_failed", time.Now())
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_passkey_bootstrap"})
			return
		}
		handoff, err := handoffs.Create(r.Context(), bootstrap.UserID, sessionID, bootstrap.AppRedirectURI, bootstrap.HandoffChallenge, time.Now())
		if err != nil {
			if bootstrap.SourcePreAuthHash != "" && sessionID != "" {
				_ = sessions.RevokeOwnedSession(r.Context(), bootstrap.UserID, sessionID, "passkey_handoff_failed", time.Now())
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session_handoff_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"handoff_code": handoff.Code, "app_redirect_uri": handoff.AppRedirectURI}})
	}
}
