package db

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
)

func TestPostgresMigrationCreatesAuthTables(t *testing.T) {
	if os.Getenv("TEST_POSTGRES") != "1" {
		t.Skip("PostgreSQL integration test requires TEST_POSTGRES=1")
	}
	database, err := Open(context.Background(), config.DatabaseConfig{
		Host: os.Getenv("DB_HOST"), Port: os.Getenv("DB_PORT"), Name: os.Getenv("DB_NAME"), User: os.Getenv("DB_USER"), Password: os.Getenv("DB_PASSWORD"), SSLMode: os.Getenv("DB_SSLMODE"), Schema: os.Getenv("DB_SCHEMA"),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })

	migrationPath := filepath.Join("..", "..", "migrations")
	if err := ApplyMigrations(context.Background(), database, migrationPath); err != nil {
		t.Fatal(err)
	}
	if err := ApplyMigrations(context.Background(), database, migrationPath); err != nil {
		t.Fatalf("second migration application failed: %v", err)
	}
	var tableName string
	if err := database.QueryRow("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'sessions'").Scan(&tableName); err != nil {
		t.Fatal(err)
	}
	if tableName != "sessions" {
		t.Fatalf("table = %q", tableName)
	}
	if err := database.QueryRow("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'photos'").Scan(&tableName); err != nil {
		t.Fatal(err)
	}
}
