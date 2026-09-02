package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

func TestValidateMigrationChecksum(t *testing.T) {
	const currentChecksum = "current-checksum"

	tests := []struct {
		name    string
		version string
		stored  string
		wantErr bool
	}{
		{
			name:    "current checksum",
			version: "0042_chat_attachment_key_envelope_primary_key.sql",
			stored:  currentChecksum,
		},
		{
			name:    "audited legacy 0040 checksum",
			version: legacyChatAttachmentKeyEnvelopesVersion,
			stored:  legacyChatAttachmentKeyEnvelopesChecksum,
		},
		{
			name:    "legacy checksum with unexpected current 0040 checksum",
			version: legacyChatAttachmentKeyEnvelopesVersion,
			stored:  legacyChatAttachmentKeyEnvelopesChecksum,
			wantErr: true,
		},
		{
			name:    "unknown checksum for 0040",
			version: legacyChatAttachmentKeyEnvelopesVersion,
			stored:  "deadbeef",
			wantErr: true,
		},
		{
			name:    "legacy checksum on another migration",
			version: "0042_chat_attachment_key_envelope_primary_key.sql",
			stored:  legacyChatAttachmentKeyEnvelopesChecksum,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			current := currentChecksum
			if tt.name == "audited legacy 0040 checksum" {
				current = currentChatAttachmentKeyEnvelopesChecksum
			}
			err := validateMigrationChecksum(tt.version, tt.stored, current)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateMigrationChecksum() error = %v, wantErr %t", err, tt.wantErr)
			}
		})
	}
}

func TestPostgresLegacy0040ChecksumMigration(t *testing.T) {
	if os.Getenv("TEST_POSTGRES") != "1" {
		t.Skip("PostgreSQL integration test requires TEST_POSTGRES=1")
	}

	database := openIsolatedMigrationDatabase(t)
	migrationPath := filepath.Join("..", "..", "migrations")
	ctx := context.Background()
	if err := ApplyMigrations(ctx, database, migrationPath); err != nil {
		t.Fatalf("initial migration application failed: %v", err)
	}

	const forwardVersion = "0042_chat_attachment_key_envelope_primary_key.sql"
	for _, statement := range []string{
		`ALTER TABLE chat_attachment_key_envelopes DROP CONSTRAINT IF EXISTS chat_attachment_key_envelopes_pkey`,
		`ALTER TABLE chat_attachment_key_envelopes ADD CONSTRAINT chat_attachment_key_envelopes_pkey PRIMARY KEY (attachment_id, device_id)`,
	} {
		if _, err := database.ExecContext(ctx, statement); err != nil {
			t.Fatalf("prepare legacy 0040 primary key: %v", err)
		}
	}
	if _, err := database.ExecContext(ctx, `DELETE FROM schema_migrations WHERE version=$1`, forwardVersion); err != nil {
		t.Fatalf("remove forward migration history: %v", err)
	}
	if _, err := database.ExecContext(ctx, `UPDATE schema_migrations SET checksum=$1 WHERE version=$2`, legacyChatAttachmentKeyEnvelopesChecksum, legacyChatAttachmentKeyEnvelopesVersion); err != nil {
		t.Fatalf("seed legacy 0040 checksum: %v", err)
	}

	if err := ApplyMigrations(ctx, database, migrationPath); err != nil {
		t.Fatalf("legacy checksum migration failed: %v", err)
	}

	var constraintDefinition string
	if err := database.QueryRowContext(ctx, `
		SELECT pg_get_constraintdef(c.oid)
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = current_schema()
		  AND t.relname = 'chat_attachment_key_envelopes'
		  AND c.contype = 'p'
	`).Scan(&constraintDefinition); err != nil {
		t.Fatalf("read envelope primary key: %v", err)
	}
	if constraintDefinition != "PRIMARY KEY (attachment_id, user_id, device_id)" {
		t.Fatalf("envelope primary key = %q, want triple key", constraintDefinition)
	}

	var storedChecksum string
	if err := database.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, legacyChatAttachmentKeyEnvelopesVersion).Scan(&storedChecksum); err != nil {
		t.Fatalf("read 0040 migration history: %v", err)
	}
	if storedChecksum != legacyChatAttachmentKeyEnvelopesChecksum {
		t.Fatalf("0040 checksum = %q, want audited legacy checksum", storedChecksum)
	}

	if err := ApplyMigrations(ctx, database, migrationPath); err != nil {
		t.Fatalf("second legacy migration application failed: %v", err)
	}
}

func openIsolatedMigrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	base := testDatabaseConfig()
	base.Schema = "public"
	ctx := context.Background()
	admin, err := Open(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close() })

	rawSchema := make([]byte, 8)
	if _, err := rand.Read(rawSchema); err != nil {
		t.Fatal(err)
	}
	schema := "migration_test_" + hex.EncodeToString(rawSchema)
	if _, err := admin.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.ExecContext(ctx, `DROP SCHEMA "`+schema+`" CASCADE`) })

	isolatedConfig := base
	isolatedConfig.Schema = schema
	database, err := Open(ctx, isolatedConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}
