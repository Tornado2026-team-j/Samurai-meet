package keys

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestKeyBSealOpenBindsUserAndVersion(t *testing.T) {
	service := &KeyBService{
		wrapKey:   bytes.Repeat([]byte{0x17}, 32),
		wrapKeyID: "test-v1",
	}
	plaintext := bytes.Repeat([]byte{0x41}, 32)

	ciphertext, nonce, err := service.seal("user-a", "v1", plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == base64.RawURLEncoding.EncodeToString(plaintext) {
		t.Fatal("Key-B plaintext was stored without encryption")
	}
	opened, err := service.open("user-a", "v1", ciphertext, nonce)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(opened, plaintext) {
		t.Fatal("Key-B plaintext did not round-trip")
	}
	if _, err := service.open("user-b", "v1", ciphertext, nonce); err == nil {
		t.Fatal("Key-B ciphertext was accepted for another user")
	}
	if _, err := service.open("user-a", "v2", ciphertext, nonce); err == nil {
		t.Fatal("Key-B ciphertext was accepted for another version")
	}
}
