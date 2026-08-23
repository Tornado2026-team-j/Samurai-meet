package image

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
)

func TestProfileImageKeyWrapping(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	imageKey := make([]byte, 32)
	if _, err := rand.Read(imageKey); err != nil {
		t.Fatal(err)
	}
	wrapped, err := WrapProfileImageKey(&key.PublicKey, imageKey)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := UnwrapProfileImageKey(key, wrapped)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != string(imageKey) {
		t.Fatal("unwrapped key does not match")
	}
	if jwk := PublicJWK(&key.PublicKey); jwk.Algorithm != "RSA-OAEP-256" || jwk.Modulus == "" || jwk.Exponent == "" {
		t.Fatalf("invalid JWK: %+v", jwk)
	}
}
