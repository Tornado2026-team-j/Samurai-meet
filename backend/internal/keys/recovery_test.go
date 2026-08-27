package keys

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestRecoveryProofMessageIsDomainSeparated(t *testing.T) {
	want := "samurai-meet/recovery-proof/v2\nuser-1\nv2\nchallenge"
	if got := string(RecoveryProofMessage("user-1", "v2", "challenge")); got != want {
		t.Fatalf("proof message = %q, want %q", got, want)
	}
}

func TestRecoveryEnvelopeValidationBindsKDFParameters(t *testing.T) {
	key := make([]byte, ed25519.PublicKeySize)
	params := recoveryKDFParams{
		Algorithm: recoveryKDFAlgorithm,
		Salt:      base64.RawURLEncoding.EncodeToString(make([]byte, recoverySaltBytes)),
		Info:      base64.RawURLEncoding.EncodeToString([]byte(recoveryInfo)),
		DataSalt:  base64.RawURLEncoding.EncodeToString(make([]byte, dataSaltBytes)),
		Argon2id: &argon2Params{
			MemoryKiB:   8192,
			Iterations:  1,
			Parallelism: 1,
		},
	}
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{
		KeyVersion:        ClientRootKeyVersion,
		EncryptedKeyA:     base64.RawURLEncoding.EncodeToString(make([]byte, 32+16)),
		Nonce:             base64.RawURLEncoding.EncodeToString(make([]byte, 12)),
		KDFParams:         raw,
		RecoveryPublicKey: base64.RawURLEncoding.EncodeToString(key),
	}
	if err := validate("user-1", envelope); err != nil {
		t.Fatalf("valid recovery envelope rejected: %v", err)
	}
	params.Info = base64.RawURLEncoding.EncodeToString([]byte("wrong-purpose"))
	raw, _ = json.Marshal(params)
	envelope.KDFParams = raw
	if err := validate("user-1", envelope); err == nil || !strings.Contains(err.Error(), "invalid key envelope") {
		t.Fatalf("wrong KDF info was accepted: %v", err)
	}
}
