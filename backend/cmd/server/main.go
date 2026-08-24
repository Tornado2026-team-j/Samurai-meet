package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/auth"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/db"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
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
	var oauthLogin *auth.OAuthLoginService
	if cfg.GoogleOIDC.ClientID != "" && cfg.GoogleOIDC.ClientSecret != "" && cfg.GoogleOIDC.RedirectURI != "" && cfg.JWS.SigningKey != "" {
		google, err := auth.NewGoogleOIDC(startupContext, cfg.GoogleOIDC)
		if err != nil {
			log.Fatalf("Google OAuth initialization failed: %v", err)
		}
		signer, err := auth.NewSigner(cfg.JWS.SigningKey, cfg.JWS.Issuer, cfg.JWS.Audience)
		if err != nil {
			log.Fatalf("JWS initialization failed: %v", err)
		}
		oauthLogin = auth.NewOAuthLoginService(google, auth.NewOAuthStateStore(database), database, signer)
	}

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		ReadHeaderTimeout: 10 * time.Second,
		Handler: httpapi.NewRouterWithOptions(httpapi.RouterOptions{
			Environment:     cfg.Environment,
			DevClientOrigin: cfg.DevClientOrigin,
			ClientOrigin:    cfg.ClientOrigin,
			OAuthLogin:      oauthLogin,
		}),
	}

	log.Printf("backend server listening on %s (environment=%s)", cfg.HTTPAddr, cfg.Environment)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
