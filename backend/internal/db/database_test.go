package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	for _, want := range []string{"sessions", "photos", "profiles", "user_locations", "recruitment_cards", "blocks", "matches", "chat_threads", "messages", "chat_read_states", "meeting_sessions", "meeting_proximity_latest", "chat_key_manifests", "chat_translation_rate_limits", "chat_translation_inflight"} {
		var tableName string
		if err := database.QueryRow("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1", want).Scan(&tableName); err != nil {
			t.Fatalf("table %q: %v", want, err)
		}
		if tableName != want {
			t.Fatalf("table = %q, want %q", tableName, want)
		}
	}
}

func TestPostgresChatKeyManifestCommitmentFormatConstraint(t *testing.T) {
	if os.Getenv("TEST_POSTGRES") != "1" {
		t.Skip("PostgreSQL integration test requires TEST_POSTGRES=1")
	}

	database := openIsolatedMigrationDatabase(t)
	ctx := context.Background()
	migrationPath := filepath.Join("..", "..", "migrations")
	if err := ApplyMigrations(ctx, database, migrationPath); err != nil {
		t.Fatalf("migration application failed: %v", err)
	}

	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	ownerID := "manifest-constraint-owner"
	requesterID := "manifest-constraint-requester"
	for _, user := range []struct {
		id     string
		google string
	}{
		{ownerID, "manifest-constraint-owner-google"},
		{requesterID, "manifest-constraint-requester-google"},
	} {
		if _, err := database.ExecContext(ctx, `
			INSERT INTO users (id,google_subject_id,status,created_at,updated_at)
			VALUES ($1,$2,'active',$3,$3)`, user.id, user.google, stamp); err != nil {
			t.Fatalf("insert user %q: %v", user.id, err)
		}
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,visibility_radius_km,status,expires_at,created_at,updated_at)
		VALUES ('manifest-constraint-card',$1,'Food','2026-09-03','18:00','20:00','Asia/Tokyo',3,'matched',$2,$3,$3)`, ownerID, stamp, stamp); err != nil {
		t.Fatalf("insert recruitment card: %v", err)
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at)
		VALUES ('manifest-constraint-match','manifest-constraint-card',$1,$2,'accepted',$3,$3,$3)`, requesterID, ownerID, stamp); err != nil {
		t.Fatalf("insert match: %v", err)
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO chat_threads (id,match_id,created_at,updated_at)
		VALUES ('manifest-constraint-chat','manifest-constraint-match',$1,$1)`, stamp); err != nil {
		t.Fatalf("insert chat thread: %v", err)
	}

	valid := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	if _, err := database.ExecContext(ctx, `
		INSERT INTO chat_key_manifests (chat_id,authority_user_id,key_commitment,created_at,updated_at)
		VALUES ('manifest-constraint-chat',$1,$2,$3,$3)`, ownerID, valid, stamp); err != nil {
		t.Fatalf("valid raw Base64URL commitment rejected: %v", err)
	}
	if _, err := database.ExecContext(ctx, `DELETE FROM chat_key_manifests WHERE chat_id='manifest-constraint-chat'`); err != nil {
		t.Fatalf("delete valid manifest: %v", err)
	}

	for _, invalid := range []struct {
		name  string
		value string
	}{
		{name: "padding", value: strings.Repeat("A", 42) + "="},
		{name: "non-base64url character", value: strings.Repeat("A", 42) + "/"},
	} {
		t.Run(invalid.name, func(t *testing.T) {
			if _, err := database.ExecContext(ctx, `
				INSERT INTO chat_key_manifests (chat_id,authority_user_id,key_commitment,created_at,updated_at)
				VALUES ('manifest-constraint-chat',$1,$2,$3,$3)`, ownerID, invalid.value, stamp); err == nil {
				t.Fatalf("invalid commitment %q was accepted", invalid.value)
			}
		})
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
		current string
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
			current: currentChatAttachmentKeyEnvelopesChecksum,
		},
		{
			name:    "audited legacy 0044 checksum",
			version: legacyChatMessageTranslationsVersion,
			stored:  legacyChatMessageTranslationsChecksum,
			current: currentChatMessageTranslationsChecksum,
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
		{
			name:    "legacy 0044 checksum with unexpected current checksum",
			version: legacyChatMessageTranslationsVersion,
			stored:  legacyChatMessageTranslationsChecksum,
			current: currentChecksum,
			wantErr: true,
		},
		{
			name:    "unknown checksum for 0044",
			version: legacyChatMessageTranslationsVersion,
			stored:  "deadbeef",
			current: currentChatMessageTranslationsChecksum,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			current := currentChecksum
			if tt.current != "" {
				current = tt.current
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

func TestPostgresLegacy0044ForwardMigration(t *testing.T) {
	if os.Getenv("TEST_POSTGRES") != "1" {
		t.Skip("PostgreSQL integration test requires TEST_POSTGRES=1")
	}

	database := openIsolatedMigrationDatabase(t)
	migrationPath := filepath.Join("..", "..", "migrations")
	ctx := context.Background()
	if err := ApplyMigrations(ctx, database, migrationPath); err != nil {
		t.Fatalf("initial migration application failed: %v", err)
	}

	for _, statement := range []string{
		`DROP TABLE chat_message_translations`,
		`CREATE TABLE chat_message_translations (
			message_id TEXT NOT NULL,
			target_language TEXT NOT NULL CHECK (target_language IN ('ja', 'en')),
			source_language TEXT NOT NULL,
			translated_text TEXT NOT NULL,
			message_revision TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (message_id, target_language)
		)`,
		`INSERT INTO chat_message_translations
			(message_id,target_language,source_language,translated_text,message_revision,created_at,updated_at)
			VALUES ('legacy-message','en','ja','旧平文翻訳','revision-1','2026-09-02T00:00:00Z','2026-09-02T00:00:00Z')`,
		`DELETE FROM schema_migrations WHERE version='0045_chat_message_translations_encrypted.sql'`,
		`UPDATE schema_migrations SET checksum='` + legacyChatMessageTranslationsChecksum + `' WHERE version='` + legacyChatMessageTranslationsVersion + `'`,
	} {
		if _, err := database.ExecContext(ctx, statement); err != nil {
			t.Fatalf("prepare legacy 0044 schema: %v", err)
		}
	}

	if err := ApplyMigrations(ctx, database, migrationPath); err != nil {
		t.Fatalf("legacy 0044 migration failed: %v", err)
	}

	for _, column := range []string{"ciphertext", "nonce", "algorithm", "key_version"} {
		var columnName string
		if err := database.QueryRowContext(ctx, `
			SELECT column_name
			FROM information_schema.columns
			WHERE table_schema = current_schema()
			  AND table_name = 'chat_message_translations'
			  AND column_name = $1`, column).Scan(&columnName); err != nil {
			t.Fatalf("encrypted translation column %q: %v", column, err)
		}
	}
	for _, column := range []string{"source_language", "translated_text"} {
		var count int
		if err := database.QueryRowContext(ctx, `
			SELECT COUNT(*)
			FROM information_schema.columns
			WHERE table_schema = current_schema()
			  AND table_name = 'chat_message_translations'
			  AND column_name = $1`, column).Scan(&count); err != nil {
			t.Fatalf("legacy translation column %q: %v", column, err)
		}
		if count != 0 {
			t.Fatalf("legacy plaintext column %q still exists", column)
		}
	}

	var rowCount int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_message_translations`).Scan(&rowCount); err != nil {
		t.Fatalf("count migrated translations: %v", err)
	}
	if rowCount != 0 {
		t.Fatalf("legacy plaintext translations = %d, want 0", rowCount)
	}

	var storedChecksum string
	if err := database.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, legacyChatMessageTranslationsVersion).Scan(&storedChecksum); err != nil {
		t.Fatalf("read legacy 0044 migration history: %v", err)
	}
	if storedChecksum != legacyChatMessageTranslationsChecksum {
		t.Fatalf("0044 checksum = %q, want audited legacy checksum", storedChecksum)
	}

	if err := ApplyMigrations(ctx, database, migrationPath); err != nil {
		t.Fatalf("second legacy 0044 migration application failed: %v", err)
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
