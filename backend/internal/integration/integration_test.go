package integration

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/account"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/db"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

func TestAuthKeyImageAndAccountLifecycle(t *testing.T) {
	database := openIsolatedDatabase(t)
	now := time.Date(2026, time.August, 24, 12, 0, 0, 0, time.UTC)
	userID := randomID(t)
	googleSubject := "integration-google-" + userID
	if _, err := database.Exec(`INSERT INTO users (id,google_subject_id,status,created_at,updated_at) VALUES ($1,$2,'active',$3,$3)`, userID, googleSubject, now.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}

	signer, err := auth.NewSigner(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32)), "integration-issuer", "integration-audience")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionService(database, signer)
	tokens, err := sessions.CreateSession(context.Background(), userID, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Authenticate(context.Background(), tokens.AccessToken, now.Add(10*time.Second)); err != nil {
		t.Fatalf("fresh access token was rejected: %v", err)
	}
	rotated, err := sessions.Refresh(context.Background(), tokens.RefreshToken, "integration-refresh-request", now.Add(10*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	retry, err := sessions.Refresh(context.Background(), tokens.RefreshToken, "integration-refresh-request", now.Add(11*time.Second))
	if err != nil {
		t.Fatalf("same refresh request was not idempotent: %v", err)
	}
	if retry.RefreshToken != rotated.RefreshToken || retry.AccessToken != rotated.AccessToken {
		t.Fatal("refresh retry returned different tokens")
	}
	if _, err := sessions.Refresh(context.Background(), tokens.RefreshToken, "different-request", now.Add(12*time.Second)); err != auth.ErrRefreshReuse {
		t.Fatalf("refresh reuse error = %v, want %v", err, auth.ErrRefreshReuse)
	}
	if _, err := sessions.Authenticate(context.Background(), rotated.AccessToken, now.Add(13*time.Second)); err == nil {
		t.Fatal("refresh-token reuse did not revoke the session")
	}

	preauth := auth.NewPreAuthService(database)
	preAuthToken, err := preauth.Issue(context.Background(), userID, auth.PreAuthScopeLogin, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = preauth.Lookup(context.Background(), preAuthToken, auth.PreAuthScopeLogin, userID, now.Add(time.Second)); err != nil {
		t.Fatalf("pre-auth lookup failed: %v", err)
	}
	preAuthTx, err := database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err = preauth.ConsumeTx(preAuthTx, preAuthToken, auth.PreAuthScopeLogin, userID, now.Add(2*time.Second)); err != nil {
		_ = preAuthTx.Rollback()
		t.Fatal(err)
	}
	if err = preAuthTx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err = preauth.Lookup(context.Background(), preAuthToken, auth.PreAuthScopeLogin, userID, now.Add(3*time.Second)); err == nil {
		t.Fatal("consumed pre-auth token was accepted")
	}

	passkeySession, err := sessions.CreateSession(context.Background(), userID, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.Exec(`UPDATE sessions SET last_passkey_at=$1 WHERE id=$2`, now.Format(time.RFC3339Nano), passkeySession.SessionID); err != nil {
		t.Fatal(err)
	}
	handoffVerifier := "integration-session-handoff-verifier"
	handoffChallengeBytes := sha256.Sum256([]byte(handoffVerifier))
	handoffChallenge := base64.RawURLEncoding.EncodeToString(handoffChallengeBytes[:])
	handoffs := auth.NewSessionHandoffService(database, sessions, signer)
	handoff, err := handoffs.Create(context.Background(), userID, passkeySession.SessionID, "samuraimeet://auth", handoffChallenge, now.Add(4*time.Second))
	if err != nil {
		t.Fatalf("session handoff create failed: %v", err)
	}
	const handoffRequestID = "integration-session-handoff-exchange"
	appTokens, err := handoffs.Exchange(context.Background(), handoff.Code, handoffVerifier, handoffRequestID, now.Add(5*time.Second))
	if err != nil {
		t.Fatalf("session handoff exchange failed: %v", err)
	}
	if appTokens.UserID != userID || appTokens.AccessToken == "" || appTokens.RefreshToken == "" {
		t.Fatal("session handoff returned incomplete tokens")
	}
	retryTokens, err := handoffs.Exchange(context.Background(), handoff.Code, handoffVerifier, handoffRequestID, now.Add(6*time.Second))
	if err != nil || retryTokens != appTokens {
		t.Fatalf("same handoff request retry = %+v, err=%v", retryTokens, err)
	}
	if _, err = handoffs.Exchange(context.Background(), handoff.Code, handoffVerifier, "different-session-handoff-request", now.Add(7*time.Second)); err == nil {
		t.Fatal("session handoff accepted a different request ID")
	}
	if _, err = handoffs.Exchange(context.Background(), handoff.Code, "wrong-verifier", handoffRequestID, now.Add(8*time.Second)); err == nil {
		t.Fatal("session handoff accepted an incorrect verifier")
	}

	envelopes := keys.NewService(database)
	encryptedKeyA := randomBytes(t, 32)
	envelopeNonce := randomBytes(t, 12)
	storedEnvelope, err := envelopes.Upsert(context.Background(), userID, keys.Envelope{
		KeyVersion:    "v1",
		EncryptedKeyA: encode(encryptedKeyA),
		Nonce:         encode(envelopeNonce),
		KDFParams:     json.RawMessage(`{"algorithm":"scrypt","salt":"integration","work_factor":1}`),
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if storedEnvelope.EncryptedKeyA != encode(encryptedKeyA) {
		t.Fatal("encrypted Key-A envelope was changed")
	}
	listed, err := envelopes.List(context.Background(), userID)
	if err != nil || len(listed) != 1 {
		t.Fatalf("key envelope list = %d, err=%v", len(listed), err)
	}

	devices := keys.NewDeviceService(database)
	deviceID := "device-" + userID
	devicePublicKey, devicePrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devices.Register(context.Background(), userID, deviceID, "v1", encode(devicePublicKey), now); err != nil {
		t.Fatal(err)
	}
	proofTimestamp := now.Add(time.Second).Format(time.RFC3339Nano)
	proofNonce := encode(randomBytes(t, 16))
	emptyHash := sha256.Sum256(nil)
	bodyHash := encode(emptyHash[:])
	proofMessage := strings.Join([]string{keys.DeviceProofDomain, userID, deviceID, http.MethodGet, "/api/v1/me/photos/example", proofTimestamp, proofNonce, bodyHash}, "\n")
	proofSignature := encode(ed25519.Sign(devicePrivateKey, []byte(proofMessage)))
	if err := devices.VerifyProof(context.Background(), userID, deviceID, http.MethodGet, "/api/v1/me/photos/example", proofTimestamp, proofNonce, bodyHash, proofSignature, now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := devices.VerifyProof(context.Background(), userID, deviceID, http.MethodGet, "/api/v1/me/photos/example", proofTimestamp, proofNonce, bodyHash, proofSignature, now.Add(2*time.Second)); err != keys.ErrDeviceProofReplay {
		t.Fatalf("replayed device proof error = %v, want %v", err, keys.ErrDeviceProofReplay)
	}

	liveNow := time.Now().UTC()
	liveSession, err := sessions.CreateSession(context.Background(), userID, liveNow)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`UPDATE sessions SET last_passkey_at=$1 WHERE id=$2`, liveNow.Format(time.RFC3339Nano), liveSession.SessionID); err != nil {
		t.Fatal(err)
	}
	profileKey, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	storageRoot := t.TempDir()
	store, err := image.NewStore(storageRoot)
	if err != nil {
		t.Fatal(err)
	}
	images := image.NewService(database, store, image.NewCiphertextCache(1<<20, time.Minute), profileKey, "v1", 1<<20)
	imageKey := randomBytes(t, 32)
	nonce := randomBytes(t, 12)
	block, err := aes.NewCipher(imageKey)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	plaintext := []byte("encrypted profile image")
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	serverWrapped, err := image.WrapProfileImageKey(&profileKey.PublicKey, imageKey)
	if err != nil {
		t.Fatal(err)
	}
	photo, err := images.Upload(context.Background(), userID, image.UploadInput{
		Visibility:        "profile",
		ContentType:       "image/png",
		Nonce:             encode(nonce),
		Algorithm:         image.PhotoAlgorithm,
		KeyVersion:        "v1",
		WrappedImageKey:   encode(randomBytes(t, 32)),
		AccountWrappedKey: encode(randomBytes(t, 32)),
		DeviceID:          deviceID,
		ServerWrappedKey:  encode(serverWrapped),
		WrappingAlgorithm: "KEY-A-AES-GCM+KEY-B-AES-GCM",
		Body:              bytes.NewReader(ciphertext),
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	_, decoded, err := images.GetPublicProfileImage(context.Background(), photo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decoded, plaintext) {
		t.Fatal("profile image plaintext did not round-trip")
	}
	if _, cachedCiphertext, err := images.GetCiphertext(context.Background(), userID, photo.ID, deviceID); err != nil || !bytes.Equal(cachedCiphertext, ciphertext) {
		t.Fatalf("ciphertext read/cache failed: %v", err)
	}

	accounts := account.NewService(database, images)
	if err := accounts.Delete(context.Background(), userID, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := database.QueryRow(`SELECT COUNT(*) FROM users WHERE id=$1`, userID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("deleted user rows = %d", remaining)
	}
	if _, err := os.Stat(filepath.Join(storageRoot, userID)); !os.IsNotExist(err) {
		t.Fatalf("encrypted image directory remains: %v", err)
	}
}

func openIsolatedDatabase(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("TEST_POSTGRES") != "1" {
		t.Skip("PostgreSQL integration test requires TEST_POSTGRES=1")
	}
	base := config.DatabaseConfig{
		Host:     os.Getenv("DB_HOST"),
		Port:     os.Getenv("DB_PORT"),
		Name:     os.Getenv("DB_NAME"),
		User:     os.Getenv("DB_USER"),
		Password: os.Getenv("DB_PASSWORD"),
		SSLMode:  os.Getenv("DB_SSLMODE"),
		Schema:   "public",
	}
	ctx := context.Background()
	admin, err := db.Open(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close() })
	schema := "test_" + hex.EncodeToString(randomBytes(t, 8))
	if _, err := admin.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.ExecContext(ctx, `DROP SCHEMA "`+schema+`" CASCADE`) })
	isolatedConfig := base
	isolatedConfig.Schema = schema
	database, err := db.Open(ctx, isolatedConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := db.ApplyMigrations(ctx, database, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatal(err)
	}
	return database
}

func randomBytes(t *testing.T, size int) []byte {
	t.Helper()
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func randomID(t *testing.T) string { return encode(randomBytes(t, 16)) }

func encode(raw []byte) string { return base64.RawURLEncoding.EncodeToString(raw) }
