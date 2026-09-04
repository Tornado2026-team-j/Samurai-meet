package auth

import (
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/go-webauthn/webauthn/webauthn"
)

// NewPasskeyRelyingParty creates the verifier used for every registration and
// assertion ceremony. Credential data and challenge state are persisted by the
// auth repository, never trusted from the client.
func NewPasskeyRelyingParty(cfg config.WebAuthnConfig) (*webauthn.WebAuthn, error) {
	origins := make([]string, 0, 1+len(cfg.AdditionalRPOrigins))
	appendOrigin := func(value string) {
		value = strings.TrimRight(strings.TrimSpace(value), "/")
		if value == "" {
			return
		}
		for _, existing := range origins {
			if existing == value {
				return
			}
		}
		origins = append(origins, value)
	}
	appendOrigin(cfg.RPOrigin)
	for _, origin := range cfg.AdditionalRPOrigins {
		appendOrigin(origin)
	}
	return webauthn.New(&webauthn.Config{RPID: cfg.RPID, RPDisplayName: cfg.RPDisplayName, RPOrigins: origins})
}
