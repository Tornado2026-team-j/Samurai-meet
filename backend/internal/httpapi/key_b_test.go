package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

func TestWriteKeyBMaterialDisablesCaching(t *testing.T) {
	response := httptest.NewRecorder()
	writeKeyBMaterial(response, keys.KeyBMaterial{KeyVersion: "v1", KeyB: "test-key-b"})

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want %q", got, "private, no-store")
	}
	if body := response.Body.String(); !strings.Contains(body, `"key_b":"test-key-b"`) {
		t.Fatalf("response omitted Key-B payload: %s", body)
	}
}
