package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func TestRouterDoesNotServeBrowserAssets(t *testing.T) {
	handler := NewRouterWithOptions(RouterOptions{Environment: "development"})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNotFound)
	}
}
