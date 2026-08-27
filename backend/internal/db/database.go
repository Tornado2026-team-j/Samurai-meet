package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Open connects to the configured database. Credentials are never logged.
func Open(ctx context.Context, cfg config.DatabaseConfig) (*sql.DB, error) {
	dsn, err := connection(cfg)
	if err != nil {
		return nil, err
	}
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	if err := database.PingContext(ctx); err != nil {
		if closeErr := database.Close(); closeErr != nil {
			return nil, fmt.Errorf("database ping failed: %w (close failed: %v)", err, closeErr)
		}
		return nil, err
	}
	return database, nil
}

func connection(cfg config.DatabaseConfig) (string, error) {
	if cfg.Host == "" || cfg.Port == "" || cfg.Name == "" || cfg.User == "" {
		return "", fmt.Errorf("DB_HOST, DB_PORT, DB_NAME, and DB_USER are required")
	}
	return fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s sslmode=%s search_path=%s", cfg.Host, cfg.Port, cfg.Name, cfg.User, cfg.Password, cfg.SSLMode, cfg.Schema), nil
}

// ApplyInitialMigration applies the auth/session schema once at startup.
func ApplyInitialMigration(ctx context.Context, database *sql.DB, path string) error {
	sqlBytes, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return err
	}
	statements := strings.Split(string(sqlBytes), ";")
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	for _, statement := range statements {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := transaction.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return transaction.Commit()
}

const migrationLockSQL = `SELECT pg_advisory_lock(hashtext('samurai-meet/schema-migrations'))`
const migrationUnlockSQL = `SELECT pg_advisory_unlock(hashtext('samurai-meet/schema-migrations'))`

// ApplyMigrations applies ordered .sql migrations exactly once. The checksum
// makes an already-applied migration immutable: silently editing a migration
// after production has seen it would make different databases have different
// security schemas. A PostgreSQL advisory lock serializes startup across
// multiple server instances.
func ApplyMigrations(ctx context.Context, database *sql.DB, directory string) error {
	if database == nil {
		return fmt.Errorf("database is required")
	}
	entries, err := os.ReadDir(filepath.Clean(directory))
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	connection, err := database.Conn(ctx)
	if err != nil {
		return err
	}
	defer connection.Close()
	if _, err = connection.ExecContext(ctx, migrationLockSQL); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer connection.ExecContext(ctx, migrationUnlockSQL)
	if _, err = connection.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		checksum TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`); err != nil {
		return fmt.Errorf("create migration history: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") || strings.HasSuffix(entry.Name(), ".down.sql") {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		contents, err := os.ReadFile(filepath.Clean(path))
		if err != nil {
			return fmt.Errorf("read %s: %w", entry.Name(), err)
		}
		migrationSQL := strings.ReplaceAll(strings.ReplaceAll(string(contents), "\r\n", "\n"), "\r", "\n")
		digest := sha256.Sum256([]byte(migrationSQL))
		checksum := hex.EncodeToString(digest[:])
		var storedChecksum string
		err = connection.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, entry.Name()).Scan(&storedChecksum)
		switch {
		case err == nil && storedChecksum != checksum:
			return fmt.Errorf("migration %s checksum mismatch", entry.Name())
		case err == nil:
			continue
		case err != sql.ErrNoRows:
			return fmt.Errorf("read migration history for %s: %w", entry.Name(), err)
		}

		transaction, err := connection.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin %s: %w", entry.Name(), err)
		}
		if err = executeMigrationSQL(ctx, transaction, migrationSQL); err == nil {
			_, err = transaction.ExecContext(ctx, `INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)`, entry.Name(), checksum)
		}
		if err != nil {
			_ = transaction.Rollback()
			return fmt.Errorf("apply %s: %w", entry.Name(), err)
		}
		if err = transaction.Commit(); err != nil {
			return fmt.Errorf("commit %s: %w", entry.Name(), err)
		}
	}
	return nil
}

type migrationExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func executeMigrationSQL(ctx context.Context, executor migrationExecutor, contents string) error {
	for _, statement := range strings.Split(contents, ";") {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := executor.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}
