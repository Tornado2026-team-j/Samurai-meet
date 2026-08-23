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
	_ "modernc.org/sqlite"
)

// Open connects to the configured database. Credentials are never logged.
func Open(ctx context.Context, cfg config.DatabaseConfig) (*sql.DB, error) {
	driver, dsn, err := connection(cfg)
	if err != nil {
		return nil, err
	}
	database, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	if err := database.PingContext(ctx); err != nil {
		database.Close()
		return nil, err
	}
	if cfg.Driver == "sqlite" {
		if _, err := database.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
			database.Close()
			return nil, err
		}
	}
	return database, nil
}

func connection(cfg config.DatabaseConfig) (string, string, error) {
	switch cfg.Driver {
	case "sqlite":
		if cfg.SQLitePath == "" {
			return "", "", fmt.Errorf("SQLITE_PATH is required")
		}
		return "sqlite", "file:" + cfg.SQLitePath + "?_pragma=foreign_keys(1)", nil
	case "postgres":
		if cfg.Host == "" || cfg.Port == "" || cfg.Name == "" || cfg.User == "" {
			return "", "", fmt.Errorf("DB_HOST, DB_PORT, DB_NAME, and DB_USER are required for postgres")
		}
		dsn := fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s sslmode=%s search_path=%s", cfg.Host, cfg.Port, cfg.Name, cfg.User, cfg.Password, cfg.SSLMode, cfg.Schema)
		return "pgx", dsn, nil
	default:
		return "", "", fmt.Errorf("unsupported DB_DRIVER %q", cfg.Driver)
	}
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
