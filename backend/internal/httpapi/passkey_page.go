package httpapi

import (
	"crypto/rand"
	_ "embed"
	"encoding/base64"
	"net/http"
	"strings"
)

//go:embed passkey_page.html
var passkeyPageHTML string

const passkeyPageNonceMarker = "__CSP_NONCE__"           // #nosec G101 -- fixed HTML replacement marker, not a credential
const passkeyPageLanguageMarker = "__PASSKEY_LANGUAGE__" // #nosec G101 -- fixed HTML replacement marker, not a credential
const passkeyPageVersionMarker = "__PASSKEY_PAGE_VERSION__" // #nosec G101 -- fixed HTML replacement marker, not a credential
const passkeyPageVersion = "passkey-web-v2026.09.02.4"      // #nosec G101 -- fixed page version identifier, not a credential

func passkeyPage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/passkey" && r.URL.Path != "/passkey/" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	nonceBytes := make([]byte, 18)
	if _, err := rand.Read(nonceBytes); err != nil {
		http.Error(w, "passkey page unavailable", http.StatusInternalServerError)
		return
	}
	nonce := base64.RawStdEncoding.EncodeToString(nonceBytes)
	page := strings.ReplaceAll(passkeyPageHTML, passkeyPageNonceMarker, nonce)
	language := "ja"
	if r.URL.Query().Get("lang") == "en" {
		language = "en"
	}
	page = strings.ReplaceAll(page, passkeyPageLanguageMarker, language)
	page = strings.ReplaceAll(page, passkeyPageVersionMarker, passkeyPageVersion)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Permissions-Policy", "publickey-credentials-create=(self), publickey-credentials-get=(self)")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write([]byte(page))
}
