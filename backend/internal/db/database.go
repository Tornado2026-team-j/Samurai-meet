package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
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
		database.Close()
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

// ApplyMigrations applies every ordered .sql migration in a directory.
func ApplyMigrations(ctx context.Context, database *sql.DB, directory string) error {
	entries, err := os.ReadDir(filepath.Clean(directory))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") || strings.HasSuffix(entry.Name(), ".down.sql") {
			continue
		}
		if err := ApplyInitialMigration(ctx, database, filepath.Join(directory, entry.Name())); err != nil {
			return fmt.Errorf("apply %s: %w", entry.Name(), err)
		}
	}
	return nil
}
