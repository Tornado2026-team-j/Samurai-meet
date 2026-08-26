package keys

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
)

const (
	RecoveryChallengeTTL  = 10 * time.Minute
	RecoveryMaxAttempts   = 5
	RecoveryRateWindow    = time.Hour
	RecoveryMaxChallenges = 10
	recoveryProofDomain   = "samurai-meet/recovery-proof/v1"
)

var (
	ErrRecoveryUnavailable = errors.New("recovery material is unavailable")
	ErrRecoveryChallenge   = errors.New("recovery challenge is invalid, expired, or already used")
	ErrRecoveryProof       = errors.New("recovery proof is invalid")
	ErrRecoveryRateLimited = errors.New("recovery challenge rate limit exceeded")
)

// RecoveryChallenge contains the opaque encrypted Key-A envelope and a
// one-time public challenge. The Recovery Key itself never appears here.
type RecoveryChallenge struct {
	ChallengeID string    `json:"challenge_id"`
	Challenge   string    `json:"challenge"`
	Envelope    Envelope  `json:"envelope"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type RecoveryProof struct {
	ChallengeID string `json:"challenge_id"`
	Challenge   string `json:"challenge"`
	KeyVersion  string `json:"key_version"`
	Signature   string `json:"signature"`
}

// RecoveryResult is a new, short-lived register pre-auth capability. It is
// issued only after Google pre-auth plus a valid Key-A-derived signature.
type RecoveryResult struct {
	UserID            string `json:"user_id"`
	PreAuthToken      string `json:"pre_auth_token"`
	PasskeyRequired   bool   `json:"passkey_required"`
	PasskeyRegistered bool   `json:"passkey_registered"`
	RecoveryAvailable bool   `json:"recovery_available"`
}

type RecoveryService struct {
	db      *sql.DB
	preauth *auth.PreAuthService
}

func NewRecoveryService(database *sql.DB, preauth *auth.PreAuthService) *RecoveryService {
	return &RecoveryService{db: database, preauth: preauth}
}

func (s *RecoveryService) BeginForPreAuth(ctx context.Context, token string, now time.Time) (RecoveryChallenge, error) {
	if s == nil || s.db == nil || s.preauth == nil || strings.TrimSpace(token) == "" {
		return RecoveryChallenge{}, ErrRecoveryUnavailable
	}
	claims, scope, err := s.lookupPreAuth(ctx, token, now)
	if err != nil {
		return RecoveryChallenge{}, err
	}
	return s.begin(ctx, claims.UserID, "", token, scope, now)
}

func (s *RecoveryService) BeginForSession(ctx context.Context, userID, sessionID string, now time.Time) (RecoveryChallenge, error) {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return RecoveryChallenge{}, ErrRecoveryUnavailable
	}
	return s.begin(ctx, userID, sessionID, "", "", now)
}

func (s *RecoveryService) VerifyForPreAuth(ctx context.Context, token string, proof RecoveryProof, now time.Time) (RecoveryResult, error) {
	if s == nil || s.db == nil || s.preauth == nil || strings.TrimSpace(token) == "" {
		return RecoveryResult{}, ErrRecoveryProof
	}
	claims, scope, err := s.lookupPreAuth(ctx, token, now)
	if err != nil {
		return RecoveryResult{}, ErrRecoveryProof
	}
	return s.verify(ctx, claims.UserID, "", token, scope, proof, now)
}

func (s *RecoveryService) VerifyForSession(ctx context.Context, userID, sessionID string, proof RecoveryProof, now time.Time) error {
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return ErrRecoveryProof
	}
	_, err := s.verify(ctx, userID, sessionID, "", "", proof, now)
	return err
}

func (s *RecoveryService) begin(ctx context.Context, userID, sessionID, preAuthToken string, preAuthScope auth.PreAuthScope, now time.Time) (RecoveryChallenge, error) {
	envelope, err := s.recoveryEnvelope(ctx, userID)
	if err != nil {
		return RecoveryChallenge{}, err
	}
	var recentChallenges int
	if err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM recovery_challenges WHERE user_id=$1 AND created_at>$2`, userID, now.Add(-RecoveryRateWindow).UTC().Format(time.RFC3339Nano)).Scan(&recentChallenges); err != nil {
		return RecoveryChallenge{}, err
	}
	if recentChallenges >= RecoveryMaxChallenges {
		return RecoveryChallenge{}, ErrRecoveryRateLimited
	}
	challengeBytes := make([]byte, 32)
	if _, err = rand.Read(challengeBytes); err != nil {
		return RecoveryChallenge{}, err
	}
	idBytes := make([]byte, 32)
	if _, err = rand.Read(idBytes); err != nil {
		return RecoveryChallenge{}, err
	}
	challenge := base64.RawURLEncoding.EncodeToString(challengeBytes)
	challengeID := base64.RawURLEncoding.EncodeToString(idBytes)
	expires := now.Add(RecoveryChallengeTTL).UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO recovery_challenges
		(id,user_id,source_session_id,pre_auth_token_hash,pre_auth_scope,key_version,recovery_public_key,challenge_hash,expires_at,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		challengeID,
		userID,
		nullableString(sessionID),
		nullableString(hashPreAuthForStorage(preAuthToken)),
		nullableString(string(preAuthScope)),
		envelope.KeyVersion,
		envelope.RecoveryPublicKey,
		hashRecoveryChallenge(challenge),
		expires.Format(time.RFC3339Nano),
		now.UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return RecoveryChallenge{}, err
	}
	return RecoveryChallenge{ChallengeID: challengeID, Challenge: challenge, Envelope: envelope, ExpiresAt: expires}, nil
}

func (s *RecoveryService) verify(ctx context.Context, userID, sessionID, preAuthToken string, preAuthScope auth.PreAuthScope, proof RecoveryProof, now time.Time) (RecoveryResult, error) {
	if !validRecoveryProofInput(proof) {
		return RecoveryResult{}, ErrRecoveryProof
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RecoveryResult{}, err
	}
	defer tx.Rollback()

	var storedUser, keyVersion, publicKey, challengeHash, expires string
	var storedSession, storedPreAuthHash, storedPreAuthScope, usedAt sql.NullString
	var attempts int
	err = tx.QueryRowContext(ctx, `
		SELECT user_id,source_session_id,pre_auth_token_hash,pre_auth_scope,key_version,recovery_public_key,challenge_hash,attempt_count,expires_at,used_at
		FROM recovery_challenges WHERE id=$1 FOR UPDATE`, proof.ChallengeID).
		Scan(&storedUser, &storedSession, &storedPreAuthHash, &storedPreAuthScope, &keyVersion, &publicKey, &challengeHash, &attempts, &expires, &usedAt)
	if err != nil {
		return RecoveryResult{}, ErrRecoveryChallenge
	}
	matchingChallenge := storedUser == userID && keyVersion == proof.KeyVersion && hashRecoveryChallenge(proof.Challenge) == challengeHash
	if !matchingChallenge {
		return RecoveryResult{}, ErrRecoveryChallenge
	}
	if usedAt.Valid {
		if attempts >= RecoveryMaxAttempts {
			return RecoveryResult{}, ErrRecoveryRateLimited
		}
		return RecoveryResult{}, ErrRecoveryChallenge
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !now.Before(expiresAt) {
		return RecoveryResult{}, ErrRecoveryChallenge
	}
	if attempts >= RecoveryMaxAttempts {
		return RecoveryResult{}, ErrRecoveryRateLimited
	}
	if sessionID != "" {
		if !storedSession.Valid || storedSession.String != sessionID || storedPreAuthHash.Valid || storedPreAuthScope.Valid {
			return RecoveryResult{}, ErrRecoveryChallenge
		}
	} else {
		if !storedPreAuthHash.Valid || storedPreAuthHash.String != hashPreAuthForStorage(preAuthToken) || !storedPreAuthScope.Valid || storedPreAuthScope.String != string(preAuthScope) || storedSession.Valid {
			return RecoveryResult{}, ErrRecoveryChallenge
		}
	}

	publicKeyBytes, err := base64.RawURLEncoding.DecodeString(publicKey)
	signature, signatureErr := base64.RawURLEncoding.DecodeString(proof.Signature)
	if err != nil || len(publicKeyBytes) != ed25519.PublicKeySize || signatureErr != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKeyBytes), recoveryProofMessage(userID, keyVersion, proof.Challenge), signature) {
		nextAttempts := attempts + 1
		var used any
		if nextAttempts >= RecoveryMaxAttempts {
			used = now.UTC().Format(time.RFC3339Nano)
		}
		if _, updateErr := tx.ExecContext(ctx, `UPDATE recovery_challenges SET attempt_count=$1,used_at=COALESCE($2,used_at) WHERE id=$3`, nextAttempts, used, proof.ChallengeID); updateErr != nil {
			return RecoveryResult{}, updateErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return RecoveryResult{}, commitErr
		}
		if nextAttempts >= RecoveryMaxAttempts {
			return RecoveryResult{}, ErrRecoveryRateLimited
		}
		return RecoveryResult{}, ErrRecoveryProof
	}

	if sessionID == "" {
		if err = s.preauth.ConsumeTx(tx, preAuthToken, preAuthScope, userID, now); err != nil {
			return RecoveryResult{}, ErrRecoveryProof
		}
	}
	var result RecoveryResult
	if sessionID == "" {
		// Recovery-based re-registration replaces the old Passkey set. Keep this
		// in the same transaction as proof verification and pre-auth issuance so
		// an old device cannot continue authenticating after recovery succeeds.
		if _, err = tx.ExecContext(ctx, `DELETE FROM passkey_credentials WHERE user_id=$1`, userID); err != nil {
			return RecoveryResult{}, err
		}
		result.PreAuthToken, err = s.preauth.IssueTx(ctx, tx, userID, auth.PreAuthScopeRegister, now)
		if err != nil {
			return RecoveryResult{}, err
		}
		result.UserID = userID
		result.PasskeyRequired = true
		result.RecoveryAvailable = true
	}
	if _, err = tx.ExecContext(ctx, `UPDATE recovery_challenges SET used_at=$1 WHERE id=$2 AND used_at IS NULL`, now.UTC().Format(time.RFC3339Nano), proof.ChallengeID); err != nil {
		return RecoveryResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return RecoveryResult{}, err
	}
	return result, nil
}

func (s *RecoveryService) lookupPreAuth(ctx context.Context, token string, now time.Time) (auth.PreAuthClaims, auth.PreAuthScope, error) {
	for _, scope := range []auth.PreAuthScope{auth.PreAuthScopeLogin, auth.PreAuthScopeRegister} {
		claims, err := s.preauth.Lookup(ctx, token, scope, "", now)
		if err == nil {
			return claims, scope, nil
		}
	}
	return auth.PreAuthClaims{}, "", ErrRecoveryChallenge
}

func (s *RecoveryService) recoveryEnvelope(ctx context.Context, userID string) (Envelope, error) {
	var envelope Envelope
	var kdfParams, createdAt, updatedAt string
	var publicKey sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT encrypted_key_a,nonce,kdf_params,recovery_public_key,key_version,created_at,updated_at
		FROM key_envelopes
		WHERE user_id=$1 AND recovery_public_key IS NOT NULL AND recovery_public_key <> ''
		ORDER BY updated_at DESC LIMIT 1`, userID).
		Scan(&envelope.EncryptedKeyA, &envelope.Nonce, &kdfParams, &publicKey, &envelope.KeyVersion, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Envelope{}, ErrRecoveryUnavailable
	}
	if err != nil {
		return Envelope{}, err
	}
	envelope.RecoveryPublicKey = publicKey.String
	envelope.KDFParams = []byte(kdfParams)
	envelope.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Envelope{}, err
	}
	envelope.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil || !validExactBase64(envelope.RecoveryPublicKey, ed25519.PublicKeySize) || !validRecoveryKDFParams(envelope.KDFParams) {
		return Envelope{}, ErrRecoveryUnavailable
	}
	return envelope, nil
}

func validRecoveryProofInput(proof RecoveryProof) bool {
	return strings.TrimSpace(proof.ChallengeID) != "" && strings.TrimSpace(proof.Challenge) != "" && keyVersionPattern.MatchString(proof.KeyVersion) && strings.TrimSpace(proof.Signature) != ""
}

func hashRecoveryChallenge(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func hashPreAuthForStorage(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return auth.HashPreAuthToken(value)
}

// RecoveryProofMessage is shared by the native client and the backend
// protocol. The domain and all context fields prevent cross-purpose signing.
func RecoveryProofMessage(userID, keyVersion, challenge string) []byte {
	return recoveryProofMessage(userID, keyVersion, challenge)
}

func recoveryProofMessage(userID, keyVersion, challenge string) []byte {
	return []byte(recoveryProofDomain + "\n" + userID + "\n" + keyVersion + "\n" + challenge)
}
