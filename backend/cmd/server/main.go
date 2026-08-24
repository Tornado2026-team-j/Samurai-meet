package main

import (
	"context"
	"crypto/rsa"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/account"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/db"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
)

func main() {
	cfg := config.Load()
	startupContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := db.Open(startupContext, cfg.Database)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer database.Close()
	if err := db.ApplyMigrations(startupContext, database, "migrations"); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}
	var signer *auth.Signer
	if cfg.JWS.SigningKey != "" {
		encodedKeys := map[string]string{cfg.JWS.KeyID: cfg.JWS.SigningKey}
		for _, entry := range strings.Split(cfg.JWS.VerifyKeys, ",") {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			keyID, encodedKey, found := strings.Cut(entry, "=")
			if !found || strings.TrimSpace(keyID) == "" || strings.TrimSpace(encodedKey) == "" {
				log.Fatalf("JWS_VERIFY_KEYS must use key_id=base64url pairs separated by commas")
			}
			keyID = strings.TrimSpace(keyID)
			encodedKey = strings.TrimSpace(encodedKey)
			if keyID == cfg.JWS.KeyID && encodedKey != cfg.JWS.SigningKey {
				log.Fatalf("JWS_VERIFY_KEYS cannot replace the active signing key")
			}
			encodedKeys[keyID] = encodedKey
		}
		signer, err = auth.NewRotatingSigner(cfg.JWS.KeyID, encodedKeys, cfg.JWS.Issuer, cfg.JWS.Audience)
		if err != nil {
			log.Fatalf("JWS initialization failed: %v", err)
		}
	}
	var oauthLogin *auth.OAuthLoginService
	preauth := auth.NewPreAuthService(database)
	if cfg.GoogleOIDC.ClientID != "" && cfg.GoogleOIDC.ClientSecret != "" && cfg.GoogleOIDC.RedirectURI != "" && signer != nil {
		google, err := auth.NewGoogleOIDC(startupContext, cfg.GoogleOIDC)
		if err != nil {
			log.Fatalf("Google OAuth initialization failed: %v", err)
		}
		oauthLogin = auth.NewOAuthLoginService(google, auth.NewOAuthStateStore(database), database, signer, preauth)
	}
	var sessions *auth.SessionService
	var passkeys *auth.PasskeyService
	var sessionHandoffs *auth.SessionHandoffService
	if signer != nil {
		sessions = auth.NewSessionService(database, signer)
		relyingParty, webauthnErr := auth.NewPasskeyRelyingParty(cfg.WebAuthn)
		if webauthnErr != nil {
			log.Fatalf("WebAuthn initialization failed: %v", webauthnErr)
		}
		passkeys = auth.NewPasskeyService(database, relyingParty, sessions, preauth)
		sessionHandoffs = auth.NewSessionHandoffService(database, sessions, signer)
	}
	imageStore, err := image.NewStore(cfg.ImageStorage.Directory)
	if err != nil {
		log.Fatalf("image storage initialization failed: %v", err)
	}
	var profileWrappingKeyPEM *rsa.PrivateKey
	if cfg.ImageStorage.ProfileWrappingPrivateKeyPEM != "" {
		profileWrappingKeyPEM, err = image.ParseWrappingPrivateKey(cfg.ImageStorage.ProfileWrappingPrivateKeyPEM)
		if err != nil {
			log.Fatalf("profile wrapping key initialization failed: %v", err)
		}
	}
	imageCache := image.NewCiphertextCache(cfg.ImageStorage.CiphertextCacheMaxBytes, time.Duration(cfg.ImageStorage.CiphertextCacheTTLSeconds)*time.Second)
	images := image.NewService(database, imageStore, imageCache, profileWrappingKeyPEM, cfg.ImageStorage.ProfileWrappingKeyVersion, int64(cfg.ImageStorage.MaxUploadBytes))
	keyEnvelopes := keys.NewService(database)
	var keyB *keys.KeyBService
	if cfg.KeyB.WrapKey != "" {
		keyB, err = keys.NewKeyBService(database, cfg.KeyB.WrapKey, cfg.KeyB.WrapKeyID)
		if err != nil {
			log.Fatalf("Key-B initialization failed: %v", err)
		}
	}
	accounts := account.NewService(database, images)

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		ReadHeaderTimeout: 10 * time.Second,
		Handler: httpapi.NewRouterWithOptions(httpapi.RouterOptions{
			Environment:         cfg.Environment,
			AllowExpoGoRedirect: cfg.AllowExpoGoRedirect,
			DevClientOrigin:     cfg.DevClientOrigin,
			DevClientDir:        cfg.DevClientDir,
			ClientOrigin:        cfg.ClientOrigin,
			OAuthLogin:          oauthLogin,
			PreAuth:             preauth,
			Sessions:            sessions,
			SessionHandoffs:     sessionHandoffs,
			Passkeys:            passkeys,
			KeyEnvelopes:        keyEnvelopes,
			KeyB:                keyB,
			Images:              images,
			Accounts:            accounts,
		}),
	}

	log.Printf("backend server listening on %s (environment=%s)", cfg.HTTPAddr, cfg.Environment)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
