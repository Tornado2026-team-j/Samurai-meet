package keys

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func TestDeviceRegistrationAcceptsOnlyCurrentProtocolVersion(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate device key: %v", err)
	}
	publicKey := base64.RawURLEncoding.EncodeToString(privateKey.Public().(ed25519.PublicKey))
	if !validDeviceRegistration("user", "device-123", DeviceKeyVersion, publicKey) {
		t.Fatal("current device key version should be accepted")
	}
	if validDeviceRegistration("user", "device-123", "v0", publicKey) {
		t.Fatal("legacy device key version must be rejected")
	}
}

func TestDeviceAgreementRegistrationRequiresX25519ProtocolVersion(t *testing.T) {
	publicKey := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	if !validDeviceAgreementRegistration("user", "device-123", DeviceAgreementKeyVersion, publicKey) {
		t.Fatal("current agreement key version should be accepted")
	}
	if validDeviceAgreementRegistration("user", "device-123", "v1", publicKey) {
		t.Fatal("Ed25519 device version must not be accepted for agreement keys")
	}
}
