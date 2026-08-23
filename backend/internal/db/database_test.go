package db

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
)

func TestSQLiteMigrationCreatesAuthTables(t *testing.T) {
	database, err := Open(context.Background(), config.DatabaseConfig{Driver: "sqlite", SQLitePath: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })

	migrationPath := filepath.Join("..", "..", "migrations", "0001_auth_sessions.sql")
	if err := ApplyInitialMigration(context.Background(), database, migrationPath); err != nil {
		t.Fatal(err)
	}
	if err := ApplyInitialMigration(context.Background(), database, migrationPath); err != nil {
		t.Fatalf("second migration application failed: %v", err)
	}
	var tableName string
	if err := database.QueryRow("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").Scan(&tableName); err != nil {
		t.Fatal(err)
	}
	if tableName != "sessions" {
		t.Fatalf("table = %q", tableName)
	}
}
