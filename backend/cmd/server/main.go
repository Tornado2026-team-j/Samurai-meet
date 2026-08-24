package main

import (
	"context"
	"log"
	"net/http"
	"time"

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

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		ReadHeaderTimeout: 10 * time.Second,
		Handler: httpapi.NewRouterWithOptions(httpapi.RouterOptions{
			Environment:     cfg.Environment,
			DevClientOrigin: cfg.DevClientOrigin,
		}),
	}

	log.Printf("backend server listening on %s (environment=%s)", cfg.HTTPAddr, cfg.Environment)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
