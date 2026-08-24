package image

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"math/big"
)

// PublicWrappingKey is a browser-compatible JWK for RSA-OAEP-256.
type PublicWrappingKey struct {
	KeyType   string `json:"kty"`
	Algorithm string `json:"alg"`
	KeyUse    string `json:"use"`
	Modulus   string `json:"n"`
	Exponent  string `json:"e"`
}

func ParseWrappingPrivateKey(encodedPEM string) (*rsa.PrivateKey, error) {
	decoded, err := base64.StdEncoding.DecodeString(encodedPEM)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(decoded)
	if block == nil {
		return nil, errors.New("invalid profile wrapping private key PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok || rsaKey.N.BitLen() < 3072 {
		return nil, errors.New("profile wrapping key must be RSA 3072 bits or stronger")
	}
	return rsaKey, nil
}

func PublicJWK(key *rsa.PublicKey) PublicWrappingKey {
	exponent := big.NewInt(int64(key.E)).Bytes()
	return PublicWrappingKey{"RSA", "RSA-OAEP-256", "enc", base64.RawURLEncoding.EncodeToString(key.N.Bytes()), base64.RawURLEncoding.EncodeToString(exponent)}
}

func WrapProfileImageKey(key *rsa.PublicKey, imageKey []byte) ([]byte, error) {
	if len(imageKey) != 32 {
		return nil, errors.New("image key must be 32 bytes")
	}
	return rsa.EncryptOAEP(sha256.New(), rand.Reader, key, imageKey, []byte("samurai-meet/profile-image/v1"))
}

func UnwrapProfileImageKey(key *rsa.PrivateKey, wrapped []byte) ([]byte, error) {
	return rsa.DecryptOAEP(sha256.New(), rand.Reader, key, wrapped, []byte("samurai-meet/profile-image/v1"))
}
