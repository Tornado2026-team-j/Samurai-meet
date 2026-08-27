package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/account"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

func TestHealthz(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, APIV1Prefix+"/healthz", nil)
	res := httptest.NewRecorder()
	NewRouter().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	if got := res.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
}

func TestPasskeyPageIsServedByBackend(t *testing.T) {
	for _, path := range []string{"/passkey", "/passkey/"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			res := httptest.NewRecorder()
			NewRouter().ServeHTTP(res, req)

			if res.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
			}
			if got := res.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
				t.Fatalf("Content-Type = %q", got)
			}
			if got := res.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
			if got := res.Header().Get("Referrer-Policy"); got != "no-referrer" {
				t.Fatalf("Referrer-Policy = %q, want no-referrer", got)
			}
			if got := res.Header().Get("Content-Security-Policy"); !strings.Contains(got, "script-src 'nonce-") {
				t.Fatalf("Content-Security-Policy = %q", got)
			}
			body := res.Body.String()
			if !strings.Contains(body, "Passkeyで本人確認") {
				t.Fatalf("page does not contain Passkey title")
			}
			if strings.Contains(body, passkeyPageNonceMarker) {
				t.Fatalf("page contains the CSP nonce marker")
			}
		})
	}
}

func TestPasskeyPageRejectsUnsupportedMethods(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/passkey", nil)
	res := httptest.NewRecorder()
	NewRouter().ServeHTTP(res, req)
	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusMethodNotAllowed)
	}
	if got := res.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q, want GET, HEAD", got)
	}
}

func TestPasskeyPageUsesRequestedLanguage(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/passkey?lang=en", nil)
	res := httptest.NewRecorder()
	NewRouter().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	if body := res.Body.String(); !strings.Contains(body, `<html lang="en">`) || !strings.Contains(body, `const language = 'en'`) {
		t.Fatalf("page was not rendered with English language: %s", body[:min(len(body), 400)])
	}

	req = httptest.NewRequest(http.MethodGet, "/passkey?lang=fr", nil)
	res = httptest.NewRecorder()
	NewRouter().ServeHTTP(res, req)
	if body := res.Body.String(); !strings.Contains(body, `<html lang="ja">`) {
		t.Fatalf("unsupported language did not fall back to Japanese")
	}
}

func TestDevelopmentCORSAllowsOnlyDevClientOrigin(t *testing.T) {
	handler := NewRouterWithOptions(RouterOptions{Environment: "development", DevClientOrigin: "http://127.0.0.1:5173"})
	req := httptest.NewRequest(http.MethodOptions, APIV1Prefix+"/healthz", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNoContent)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestDevelopmentCORSAllowsExpoWeb8081(t *testing.T) {
	handler := NewRouterWithOptions(RouterOptions{Environment: "development"})
	req := httptest.NewRequest(http.MethodOptions, APIV1Prefix+"/auth/google/exchange", nil)
	req.Header.Set("Origin", "http://localhost:8081")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNoContent)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:8081" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestProductionCORSAllowsOnlyPublicOrigin(t *testing.T) {
	handler := NewRouterWithOptions(RouterOptions{Environment: "production", ClientOrigin: "https://samurai-meet.disnana.com"})
	req := httptest.NewRequest(http.MethodOptions, APIV1Prefix+"/healthz", nil)
	req.Header.Set("Origin", "https://samurai-meet.disnana.com")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNoContent)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "https://samurai-meet.disnana.com" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestCORSAllowsWebPasskeyBootstrapHeader(t *testing.T) {
	handler := NewRouterWithOptions(RouterOptions{Environment: "development", DevClientOrigin: "http://127.0.0.1:5173"})
	req := httptest.NewRequest(http.MethodOptions, APIV1Prefix+"/auth/passkey/web/options", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	req.Header.Set("Access-Control-Request-Headers", "X-Web-Passkey-Token")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNoContent)
	}
	if got := res.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "X-Web-Passkey-Token") {
		t.Fatalf("Access-Control-Allow-Headers = %q", got)
	}
}

func TestWebPasskeyHandlersFailClosedWithoutCredentials(t *testing.T) {
	tests := map[string]http.Handler{
		"options": passkeyWebOptions(nil, nil),
		"reset":   passkeyWebReset(nil),
		"verify":  passkeyWebVerify(nil, nil, nil, nil, nil),
	}
	for name, handler := range tests {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", nil)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)

			if res.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", res.Code, http.StatusUnauthorized)
			}
			if got := res.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
			if got := res.Header().Get("Referrer-Policy"); got != "no-referrer" {
				t.Fatalf("Referrer-Policy = %q, want no-referrer", got)
			}
			body := res.Body.String()
			for _, secretName := range []string{"access_token", "refresh_token", "pre_auth_token", "bootstrap_token"} {
				if strings.Contains(body, secretName) {
					t.Fatalf("error response contains %q: %s", secretName, body)
				}
			}
		})
	}
}

func TestSensitiveAuthHandlersSetNoStoreHeaders(t *testing.T) {
	tests := map[string]struct {
		handler http.Handler
		method  string
	}{
		"bootstrap":        {handler: passkeyBootstrap(nil, nil, nil, "development", false), method: http.MethodGet},
		"handoff start":    {handler: sessionHandoffStart(nil, nil, "development", false), method: http.MethodGet},
		"handoff exchange": {handler: sessionHandoffExchange(nil), method: http.MethodPost},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, "/", nil)
			res := httptest.NewRecorder()
			test.handler.ServeHTTP(res, req)
			if got := res.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
			if got := res.Header().Get("Referrer-Policy"); got != "no-referrer" {
				t.Fatalf("Referrer-Policy = %q, want no-referrer", got)
			}
		})
	}
}

func TestRecoveryHandlersFailClosedWithoutCredentials(t *testing.T) {
	for _, test := range []struct {
		name    string
		handler http.Handler
	}{
		{name: "challenge", handler: recoveryChallenge(nil, nil, nil)},
		{name: "verify", handler: recoveryVerify(nil, nil, nil)},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", nil)
			res := httptest.NewRecorder()
			test.handler.ServeHTTP(res, req)
			if res.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d", res.Code, http.StatusServiceUnavailable)
			}
			if got := res.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
			if got := res.Header().Get("Referrer-Policy"); got != "no-referrer" {
				t.Fatalf("Referrer-Policy = %q, want no-referrer", got)
			}
		})
	}
}

func TestRecoveryMissingMaterialIsNotAnEndpointNotFound(t *testing.T) {
	res := httptest.NewRecorder()
	writeRecoveryChallengeResult(res, keys.RecoveryChallenge{}, keys.ErrRecoveryUnavailable)
	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusConflict)
	}
	if body := res.Body.String(); !strings.Contains(body, `"error":"recovery_not_configured"`) {
		t.Fatalf("body = %s", body)
	}
}

func TestDeviceRouteIsRegisteredWhenServiceUnavailable(t *testing.T) {
	handler := NewRouterWithOptions(RouterOptions{Sessions: &auth.SessionService{}})
	req := httptest.NewRequest(http.MethodGet, devicePath, nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; an unconfigured device service must not become a 404 route", res.Code, http.StatusUnauthorized)
	}
}

func TestProtectedHandlersRejectMissingAccessToken(t *testing.T) {
	tests := map[string]http.Handler{
		"logout all":        logoutAllSessions(nil),
		"sessions":          listSessions(nil),
		"revoke session":    revokeSession(nil),
		"handoff start":     sessionHandoffStart(nil, nil, "development", false),
		"register options":  passkeyRegisterOptions(nil, nil, nil),
		"register verify":   passkeyRegisterVerify(nil, nil, nil),
		"reauth options":    passkeyReauthOptions(nil, nil),
		"reauth verify":     passkeyReauthVerify(nil, nil),
		"passkey list":      passkeyList(nil, nil),
		"passkey remove":    passkeyRemove(nil, nil),
		"key envelope":      keyEnvelopeList(nil, nil),
		"key envelope item": keyEnvelopeItem(nil, nil),
		"devices":           deviceRegistrations(nil, nil),
		"upload photo":      uploadPhoto(nil, nil, nil),
		"owned photo":       ownedPhoto(nil, nil, nil),
		"delete account":    deleteAccount(account.NewService(nil, nil), nil),
		"profile":           getProfile(nil, nil),
		"profile patch":     patchProfile(nil, nil),
		"recruitments":      recruitmentCollection(nil, nil),
		"recruitment item":  recruitmentItem(nil, nil),
		"matches":           matchCollection(nil, nil),
		"match action":      matchAction(nil, nil),
		"location":          updateLocation(nil, nil),
		"notifications":     notificationCollection(nil, nil),
		"notification item": notificationItem(nil, nil),
	}
	for name, handler := range tests {
		t.Run(name, func(t *testing.T) {
			method := http.MethodGet
			if name == "logout all" || name == "handoff start" || name == "register verify" || name == "reauth verify" || name == "upload photo" || name == "delete account" || name == "profile patch" || name == "recruitments" || name == "match action" || name == "location" || name == "notification item" {
				method = http.MethodPost
			}
			if name == "delete account" {
				method = http.MethodDelete
			}
			req := httptest.NewRequest(method, "/", nil)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", res.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestRouterDoesNotServeBrowserAssets(t *testing.T) {
	handler := NewRouterWithOptions(RouterOptions{Environment: "development"})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNotFound)
	}
}

func TestSecurityHeadersAreAppliedToAPIResponses(t *testing.T) {
	handler := NewRouter()
	req := httptest.NewRequest(http.MethodGet, APIV1Prefix+"/healthz", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	for header, want := range map[string]string{
		"X-Content-Type-Options":     "nosniff",
		"X-Frame-Options":            "DENY",
		"Referrer-Policy":            "no-referrer",
		"Cross-Origin-Opener-Policy": "same-origin",
		"Cache-Control":              "no-store",
	} {
		if got := res.Header().Get(header); got != want {
			t.Fatalf("%s = %q, want %q", header, got, want)
		}
	}
	if got := res.Header().Get("Content-Security-Policy"); !strings.Contains(got, "default-src 'none'") {
		t.Fatalf("Content-Security-Policy = %q", got)
	}
}

func TestCredentialRateLimitIsEnforcedWithoutTrustingForwardedHeaders(t *testing.T) {
	called := 0
	handler := withSecurityHeadersAndRateLimit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusNoContent)
	}))
	for index := 0; index < 15; index++ {
		req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/auth/passkey/login/options", nil)
		req.RemoteAddr = "192.0.2.10:1234"
		req.Header.Set("X-Forwarded-For", "198.51.100."+strconv.Itoa(index))
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusNoContent {
			t.Fatalf("request %d status = %d, want %d", index+1, res.Code, http.StatusNoContent)
		}
	}
	req := httptest.NewRequest(http.MethodPost, APIV1Prefix+"/auth/passkey/login/options", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.1")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusTooManyRequests || res.Header().Get("Retry-After") == "" {
		t.Fatalf("rate-limited response = %d, Retry-After=%q", res.Code, res.Header().Get("Retry-After"))
	}
	if called != 15 {
		t.Fatalf("downstream handler calls = %d, want 15", called)
	}
}
