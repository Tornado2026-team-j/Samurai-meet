package httpapi

import (
	"net/http"
	"net/http/httptest"
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
	handler := NewRouterWithOptions(RouterOptions{
		Environment:     "development",
		DevClientOrigin: "http://127.0.0.1:5173",
	})
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
	handler := NewRouterWithOptions(RouterOptions{
		Environment:  "production",
		ClientOrigin: "https://samurai-meet.disnana.com",
	})
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
