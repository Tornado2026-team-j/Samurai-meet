package main

import (
	"context"
	"crypto/rsa"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/account"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/chat"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/classification"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/db"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/image"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/keys"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/matching"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/meeting"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/safety"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/user"
	"log"
	"net/http"
	"strings"
	"time"
)

func main() {
	cfg := config.Load()
	if err := cfg.ValidateForEnvironment(); err != nil {
		log.Fatalf("configuration validation failed: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := db.Open(ctx, cfg.Database)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer database.Close()
	if err = db.ApplyMigrations(ctx, database, "migrations"); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}
	var signer *auth.Signer
	if cfg.JWS.SigningKey != "" {
		encoded := map[string]string{cfg.JWS.KeyID: cfg.JWS.SigningKey}
		for _, entry := range strings.Split(cfg.JWS.VerifyKeys, ",") {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			keyID, key, found := strings.Cut(entry, "=")
			if !found || strings.TrimSpace(keyID) == "" || strings.TrimSpace(key) == "" {
				log.Fatalf("JWS_VERIFY_KEYS must use key_id=base64url pairs separated by commas")
			}
			keyID = strings.TrimSpace(keyID)
			key = strings.TrimSpace(key)
			if keyID == cfg.JWS.KeyID && key != cfg.JWS.SigningKey {
				log.Fatalf("JWS_VERIFY_KEYS cannot replace the active signing key")
			}
			encoded[keyID] = key
		}
		signer, err = auth.NewRotatingSigner(cfg.JWS.KeyID, encoded, cfg.JWS.Issuer, cfg.JWS.Audience)
		if err != nil {
			log.Fatalf("JWS initialization failed: %v", err)
		}
	}
	preauth := auth.NewPreAuthService(database)
	recovery := keys.NewRecoveryService(database, preauth)
	var oauthLogin *auth.OAuthLoginService
	if cfg.GoogleOIDC.ClientID != "" && cfg.GoogleOIDC.ClientSecret != "" && cfg.GoogleOIDC.RedirectURI != "" && signer != nil {
		google, e := auth.NewGoogleOIDC(ctx, cfg.GoogleOIDC)
		if e != nil {
			log.Fatalf("Google OAuth initialization failed: %v", e)
		}
		oauthLogin = auth.NewOAuthLoginService(google, auth.NewOAuthStateStore(database), database, signer, preauth)
	}
	var sessions *auth.SessionService
	var passkeys *auth.PasskeyService
	var handoffs *auth.SessionHandoffService
	var bootstraps *auth.PasskeyBootstrapService
	if signer != nil {
		sessions = auth.NewSessionService(database, signer)
		bootstraps = auth.NewPasskeyBootstrapService(database)
		rp, e := auth.NewPasskeyRelyingParty(cfg.WebAuthn)
		if e != nil {
			log.Fatalf("WebAuthn initialization failed: %v", e)
		}
		passkeys = auth.NewPasskeyService(database, rp, sessions, preauth)
		handoffs = auth.NewSessionHandoffService(database, sessions, signer)
	}
	store, e := image.NewStore(cfg.ImageStorage.Directory)
	if e != nil {
		log.Fatalf("image storage initialization failed: %v", e)
	}
	var privateKey *rsa.PrivateKey
	if cfg.ImageStorage.ProfileWrappingPrivateKeyPEM != "" {
		privateKey, e = image.ParseWrappingPrivateKey(cfg.ImageStorage.ProfileWrappingPrivateKeyPEM)
		if e != nil {
			log.Fatalf("profile wrapping key initialization failed: %v", e)
		}
	}
	cache := image.NewCiphertextCache(cfg.ImageStorage.CiphertextCacheMaxBytes, time.Duration(cfg.ImageStorage.CiphertextCacheTTLSeconds)*time.Second)
	images := image.NewService(database, store, cache, privateKey, cfg.ImageStorage.ProfileWrappingKeyVersion, int64(cfg.ImageStorage.MaxUploadBytes))
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if e = images.ProcessPendingUserFileCleanup(cleanupCtx, 100, time.Now()); e != nil {
		cleanupCancel()
		log.Fatalf("pending encrypted image cleanup failed: %v", e)
	}
	cleanupCancel()
	envelopes := keys.NewService(database)
	devices := keys.NewDeviceService(database)
	deviceTransfers := keys.NewDeviceTransferService(database)
	accounts := account.NewService(database, images)
	profiles := user.NewService(database)
	notifications := notification.NewService(database)
	matchingService := matching.NewService(database, notifications)
	recruitmentClassifier := classification.NewGemini(cfg.Gemini.APIKey, cfg.Gemini.Model)
	chatService := chat.NewService(database, signer, notifications)
	chatService.ConfigureSendRateLimit(cfg.Chat.SendBurst, float64(cfg.Chat.SendRefillPerMinute)/60.0)
	chatService.ConfigureMessageRetention(cfg.Chat.MessageRetentionDays)
	chatService.SetClusterLogger(log.Printf)
	if err = chatService.StartClusterFanout(context.Background()); err != nil {
		log.Fatalf("chat cross-instance fan-out initialization failed: %v", err)
	}
	startChatRetentionSweep(chatService)
	meetingService := meeting.NewService(database)
	safetyService := safety.NewService(database)
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		ReadTimeout:       2 * time.Minute,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32 * 1024,
		Handler:           httpapi.NewRouterWithOptions(httpapi.RouterOptions{Environment: cfg.Environment, AllowExpoGoRedirect: cfg.AllowExpoGoRedirect, DevClientOrigin: cfg.DevClientOrigin, ClientOrigin: cfg.ClientOrigin, OAuthLogin: oauthLogin, PreAuth: preauth, Sessions: sessions, SessionHandoffs: handoffs, PasskeyBootstraps: bootstraps, Recovery: recovery, Passkeys: passkeys, KeyEnvelopes: envelopes, Devices: devices, DeviceTransfers: deviceTransfers, Images: images, Accounts: accounts, Profiles: profiles, Matching: matchingService, RecruitmentClassifier: recruitmentClassifier, Chats: chatService, Meetings: meetingService, Notifications: notifications, Safety: safetyService}),
	}
	log.Printf("chat message retention window: %d days", chatService.RetentionDays())
	log.Printf("backend server listening on %s (environment=%s)", cfg.HTTPAddr, cfg.Environment)
	if e := server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}

// startChatRetentionSweep tombstones expired chat messages once at startup and
// then every 6 hours. It is safe on every instance: the purge statement is
// idempotent and races cleanly.
func startChatRetentionSweep(chatService *chat.Service) {
	if chatService.RetentionDays() <= 0 {
		return
	}
	sweep := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		purged, err := chatService.PurgeExpiredMessages(ctx, time.Now())
		if err != nil {
			log.Printf("chat retention sweep failed: %v", err)
			return
		}
		if purged > 0 {
			log.Printf("chat retention sweep tombstoned %d message(s)", purged)
		}
	}
	go func() {
		sweep()
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			sweep()
		}
	}()
}
