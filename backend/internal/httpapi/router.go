package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/account"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/classification"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/meeting"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
	profileuser "github.com/Tornado2026-team-j/Samurai-meet/backend/internal/user"
)

const APIV1Prefix = "/api/v1"

type RouterOptions struct {
	Environment           string
	AllowExpoGoRedirect   bool
	DevClientOrigin       string
	ClientOrigin          string
	OAuthLogin            *auth.OAuthLoginService
	PreAuth               *auth.PreAuthService
	Sessions              *auth.SessionService
	SessionHandoffs       *auth.SessionHandoffService
	PasskeyBootstraps     *auth.PasskeyBootstrapService
	Recovery              *keys.RecoveryService
	Passkeys              *auth.PasskeyService
	KeyEnvelopes          *keys.Service
	Devices               *keys.DeviceService
	DeviceTransfers       *keys.DeviceTransferService
	Images                *image.Service
	Accounts              *account.Service
	Profiles              *profileuser.Service
	Matching              *matching.Service
	RecruitmentClassifier *classification.Service
	Chats                 *chat.Service
	Meetings              *meeting.Service
	Notifications         *notification.Service
}

func NewRouter() http.Handler { return NewRouterWithOptions(RouterOptions{}) }

func NewRouterWithOptions(o RouterOptions) http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("/healthz", healthz)
	m.HandleFunc("/readyz", readyz)
	m.HandleFunc("/passkey", passkeyPage)
	m.HandleFunc("/passkey/", passkeyPage)
	m.HandleFunc(APIV1Prefix+"/healthz", healthz)
	m.HandleFunc(APIV1Prefix+"/readyz", readyz)
	if o.OAuthLogin != nil {
		m.HandleFunc(APIV1Prefix+"/auth/google/start", googleStart(o.OAuthLogin, o.Environment, o.AllowExpoGoRedirect, o.ClientOrigin, o.DevClientOrigin))
		m.HandleFunc(APIV1Prefix+"/auth/google/exchange", googleExchange(o.OAuthLogin))
		m.HandleFunc("/auth/callback", googleCallback(o.OAuthLogin, o.Environment, o.AllowExpoGoRedirect, o.ClientOrigin, o.DevClientOrigin))
	}
	if o.Sessions != nil {
		m.HandleFunc(APIV1Prefix+"/auth/refresh", refreshSession(o.Sessions))
		m.HandleFunc(APIV1Prefix+"/auth/logout", logoutSession(o.Sessions))
		m.HandleFunc(APIV1Prefix+"/auth/logout-all", logoutAllSessions(o.Sessions))
		m.HandleFunc(APIV1Prefix+"/me/sessions", listSessions(o.Sessions))
		m.HandleFunc(APIV1Prefix+"/me/sessions/", revokeSession(o.Sessions))
	}
	if o.SessionHandoffs != nil && o.Sessions != nil {
		m.HandleFunc(APIV1Prefix+"/auth/session-handoff/start", sessionHandoffStart(o.SessionHandoffs, o.Sessions, o.Environment, o.AllowExpoGoRedirect))
		m.HandleFunc(APIV1Prefix+"/auth/session-handoff/exchange", sessionHandoffExchange(o.SessionHandoffs))
	}
	if o.PasskeyBootstraps != nil && o.Sessions != nil {
		m.HandleFunc(APIV1Prefix+"/auth/passkey/bootstrap", passkeyBootstrap(o.PasskeyBootstraps, o.Sessions, o.PreAuth, o.Environment, o.AllowExpoGoRedirect))
	}
	if o.Recovery != nil {
		m.HandleFunc(recoveryPath+"/challenge", recoveryChallenge(o.Recovery, o.Sessions, o.PreAuth))
		m.HandleFunc(recoveryPath+"/verify", recoveryVerify(o.Recovery, o.Sessions, o.PreAuth))
	}
	if o.PasskeyBootstraps != nil {
		m.HandleFunc(APIV1Prefix+"/auth/passkey/web/reset", passkeyWebReset(o.PasskeyBootstraps))
	}
	if o.Passkeys != nil && o.PasskeyBootstraps != nil && o.Sessions != nil && o.SessionHandoffs != nil {
		m.HandleFunc(APIV1Prefix+"/auth/passkey/web/options", passkeyWebOptions(o.Passkeys, o.PasskeyBootstraps))
		m.HandleFunc(APIV1Prefix+"/auth/passkey/web/verify", passkeyWebVerify(o.Passkeys, o.PasskeyBootstraps, o.PreAuth, o.Sessions, o.SessionHandoffs, o.Environment))
	}
	if o.Passkeys != nil && o.Sessions != nil {
		m.HandleFunc(APIV1Prefix+"/auth/passkey/register/options", passkeyRegisterOptions(o.Passkeys, o.Sessions, o.PreAuth))
		m.HandleFunc(APIV1Prefix+"/auth/passkey/register/verify", passkeyRegisterVerify(o.Passkeys, o.Sessions, o.PreAuth))
		m.HandleFunc(APIV1Prefix+"/auth/passkey/login/options", passkeyLoginOptions(o.Passkeys, o.PreAuth))
		m.HandleFunc(APIV1Prefix+"/auth/passkey/login/verify", passkeyLoginVerify(o.Passkeys, o.PreAuth))
		m.HandleFunc(APIV1Prefix+"/auth/passkey/reauth/options", passkeyReauthOptions(o.Passkeys, o.Sessions))
		m.HandleFunc(APIV1Prefix+"/auth/passkey/reauth/verify", passkeyReauthVerify(o.Passkeys, o.Sessions))
		m.HandleFunc(APIV1Prefix+"/auth/passkey", passkeyList(o.Passkeys, o.Sessions))
		m.HandleFunc(APIV1Prefix+"/auth/passkey/", passkeyRemove(o.Passkeys, o.Sessions))
	}
	if o.Sessions != nil && o.KeyEnvelopes != nil {
		m.HandleFunc(keyEnvelopePrefix, keyEnvelopeList(o.KeyEnvelopes, o.Sessions))
		m.HandleFunc(keyEnvelopePrefix+"/", keyEnvelopeItem(o.KeyEnvelopes, o.Sessions))
	}
	if o.Sessions != nil {
		m.HandleFunc(devicePath, deviceRegistrations(o.Devices, o.Sessions))
	}
	if o.Sessions != nil {
		m.HandleFunc(deviceTransferPath, deviceTransferCollection(o.DeviceTransfers, o.Sessions, o.Devices))
		m.HandleFunc(deviceTransferPath+"/", deviceTransferItem(o.DeviceTransfers, o.Sessions, o.Devices))
	}
	if o.Images != nil {
		m.HandleFunc(APIV1Prefix+"/keys/profile-image", profileWrappingKey(o.Images))
		m.HandleFunc(APIV1Prefix+"/profile-photos/", publicProfilePhoto(o.Images))
	}
	if o.Sessions != nil && o.Images != nil {
		m.HandleFunc(APIV1Prefix+"/me/photos", uploadPhoto(o.Images, o.Sessions, o.Devices))
		m.HandleFunc(APIV1Prefix+"/me/photos/", ownedPhoto(o.Images, o.Sessions, o.Devices))
	}
	if o.Sessions != nil && (o.Accounts != nil || o.Profiles != nil) {
		m.HandleFunc(APIV1Prefix+"/me", meHandler(o.Profiles, o.Accounts, o.Sessions, o.PreAuth))
	}
	if o.Sessions != nil && o.Profiles != nil {
		m.HandleFunc(APIV1Prefix+"/me/profile", patchProfile(o.Profiles, o.Sessions))
	}
	if o.Sessions != nil && o.Matching != nil {
		m.HandleFunc(recruitmentPath+"/classify", classifyRecruitment(o.RecruitmentClassifier, o.Sessions))
		m.HandleFunc(recruitmentPath, recruitmentCollection(o.Matching, o.Sessions))
		m.HandleFunc(recruitmentPath+"/mine", ownedRecruitmentCollection(o.Matching, o.Sessions))
		m.HandleFunc(recruitmentPath+"/", recruitmentItem(o.Matching, o.Sessions))
		m.HandleFunc(APIV1Prefix+"/matches", matchCollection(o.Matching, o.Sessions))
		m.HandleFunc(APIV1Prefix+"/matches/", matchAction(o.Matching, o.Sessions, o.Meetings))
		m.HandleFunc(APIV1Prefix+"/me/location", updateLocation(o.Matching, o.Sessions))
	} else if o.Sessions != nil && o.Meetings != nil {
		m.HandleFunc(APIV1Prefix+"/matches/", matchAction(nil, o.Sessions, o.Meetings))
	}
	if o.Sessions != nil && o.Chats != nil {
		m.HandleFunc(chatPath, chatCollection(o.Chats, o.Sessions))
		m.HandleFunc(chatPath+"/", chatItem(o.Chats, o.Sessions))
	}
	if o.Sessions != nil && o.Notifications != nil {
		m.HandleFunc(notificationPath, notificationCollection(o.Notifications, o.Sessions))
		m.HandleFunc(notificationPath+"/", notificationItem(o.Notifications, o.Sessions))
	}
	if o.Sessions != nil && o.Meetings != nil {
		m.HandleFunc(meetingPath+"/", meetingItem(o.Meetings, o.Sessions))
	}
	return withSecurityHeadersAndRateLimit(withCORS(withJSONContentType(m), o))
}

func withCORS(next http.Handler, o RouterOptions) http.Handler {
	allowedOrigins := clientOrigins(o.Environment, o.ClientOrigin, o.DevClientOrigin)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if containsExactOrigin(allowedOrigins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Passkey-Ceremony-Token, X-Web-Passkey-Token, X-Photo-Visibility, X-Photo-Content-Type, X-Photo-Nonce, X-Photo-Algorithm, X-Photo-Key-Version, X-Photo-Device-ID, X-Photo-Wrapped-Key, X-Photo-Account-Wrapped-Key, X-Photo-Server-Wrapped-Key, X-Photo-Wrapping-Algorithm, X-Device-Timestamp, X-Device-Nonce, X-Device-Body-SHA256, X-Device-Signature")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Expose-Headers", "X-Photo-Nonce, X-Photo-Algorithm, X-Photo-Key-Version, X-Photo-Device-ID, X-Photo-Wrapped-Key, X-Photo-Account-Wrapped-Key, X-Photo-Wrapping-Algorithm")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		if r.Header.Get("Authorization") != "" {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

var developmentClientOriginDefaults = []string{
	"http://localhost:8081",
	"http://127.0.0.1:8081",
	// Keep the previous Expo Web defaults valid for existing local checkouts.
	"http://localhost:5173",
	"http://127.0.0.1:5173",
}

func clientOrigins(environment, clientOrigin, devClientOrigin string) []string {
	origins := make([]string, 0, 1+len(developmentClientOriginDefaults))
	appendOrigin := func(value string) {
		value = strings.TrimRight(strings.TrimSpace(value), "/")
		if value == "" || containsExactOrigin(origins, value) {
			return
		}
		origins = append(origins, value)
	}
	appendOrigin(clientOrigin)
	if environment == "development" || environment == "test" {
		appendOrigin(devClientOrigin)
		for _, origin := range developmentClientOriginDefaults {
			appendOrigin(origin)
		}
	}
	return origins
}

func containsExactOrigin(origins []string, target string) bool {
	for _, origin := range origins {
		if target == origin {
			return true
		}
	}
	return false
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func readyz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func withJSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, APIV1Prefix+"/") || r.URL.Path == "/healthz" || r.URL.Path == "/readyz" || r.URL.Path == "/auth/callback" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
