package main

import (
	"log"
	"net/http"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/httpapi"
)

func main() {
	cfg := config.Load()

	server := &http.Server{
		Addr: cfg.HTTPAddr,
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
