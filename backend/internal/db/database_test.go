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
	database, err := Open(context.Background(), testDatabaseConfig())
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
	for _, want := range []string{"sessions", "photos", "profiles", "user_locations", "recruitment_cards", "blocks", "matches", "chat_threads", "messages", "chat_read_states", "meeting_sessions", "meeting_proximity_latest"} {
		var tableName string
		if err := database.QueryRow("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1", want).Scan(&tableName); err != nil {
			t.Fatalf("table %q: %v", want, err)
		}
		if tableName != want {
			t.Fatalf("table = %q, want %q", tableName, want)
		}
	}
}

func testDatabaseConfig() config.DatabaseConfig {
	schema := os.Getenv("DB_SCHEMA")
	if schema == "" {
		schema = "public"
	}
	return config.DatabaseConfig{
		Host: os.Getenv("DB_HOST"), Port: os.Getenv("DB_PORT"), Name: os.Getenv("DB_NAME"), User: os.Getenv("DB_USER"), Password: os.Getenv("DB_PASSWORD"), SSLMode: os.Getenv("DB_SSLMODE"), Schema: schema,
	}
}

func TestDatabaseConfigDefaultsSchemaToPublic(t *testing.T) {
	t.Setenv("DB_SCHEMA", "")
	if got := testDatabaseConfig().Schema; got != "public" {
		t.Fatalf("schema = %q, want public", got)
	}
}

func TestDatabaseConfigUsesConfiguredSchema(t *testing.T) {
	t.Setenv("DB_SCHEMA", "app")
	if got := testDatabaseConfig().Schema; got != "app" {
		t.Fatalf("schema = %q, want app", got)
	}
}
