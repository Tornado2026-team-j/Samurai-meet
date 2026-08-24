package auth

import (
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/go-webauthn/webauthn/webauthn"
)

// NewPasskeyRelyingParty creates the verifier used for every registration and
// assertion ceremony. Credential data and challenge state are persisted by the
// auth repository, never trusted from the client.
func NewPasskeyRelyingParty(cfg config.WebAuthnConfig) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{RPID: cfg.RPID, RPDisplayName: cfg.RPDisplayName, RPOrigins: []string{cfg.RPOrigin}})
}
