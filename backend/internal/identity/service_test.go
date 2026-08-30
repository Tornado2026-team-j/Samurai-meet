package identity

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"
)

func TestValidStripeSignature(t *testing.T) {
	now := time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC)
	body := []byte(`{"type":"identity.verification_session.verified"}`)
	secret := "whsec_test"
	timestamp := now.Unix()

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%d.", timestamp)
	_, _ = mac.Write(body)
	header := fmt.Sprintf("t=%d,v1=%s", timestamp, hex.EncodeToString(mac.Sum(nil)))

	if !validStripeSignature(header, body, secret, now) {
		t.Fatal("expected a correctly signed webhook to be accepted")
	}
	if validStripeSignature(header, []byte(`{"tampered":true}`), secret, now) {
		t.Fatal("expected a modified payload to be rejected")
	}
	if validStripeSignature(header, body, secret, now.Add(6*time.Minute)) {
		t.Fatal("expected an expired signature to be rejected")
	}
	if validStripeSignature("t=invalid,v1=invalid", body, secret, now) {
		t.Fatal("expected a malformed signature to be rejected")
	}
}
