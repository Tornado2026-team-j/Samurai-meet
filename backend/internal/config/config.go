package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config contains the process-level settings required before external services
// such as PostgreSQL, Google OAuth, and Passkey are connected.
type Config struct {
	HTTPAddr            string
	Environment         string
	AllowExpoGoRedirect bool
	DevClientOrigin     string
	ClientOrigin        string
	Database            DatabaseConfig
	ImageStorage        ImageStorageConfig
	GoogleOIDC          GoogleOIDCConfig
	WebAuthn            WebAuthnConfig
	JWS                 JWSConfig
}

type GoogleOIDCConfig struct{ ClientID, ClientSecret, RedirectURI string }
type WebAuthnConfig struct{ RPID, RPOrigin, RPDisplayName string }
type JWSConfig struct{ SigningKey, Issuer, Audience string }

type ImageStorageConfig struct {
	Directory                    string
	ProfileWrappingPrivateKeyPEM string
	CiphertextCacheMaxBytes      int
	CiphertextCacheTTLSeconds    int
}

// DatabaseConfig holds separately managed database connection settings.
// The database adapter builds a driver-specific connection string from these
// values; a password is never logged.
type DatabaseConfig struct {
	Host     string
	Port     string
	Name     string
	User     string
	Password string
	SSLMode  string
	Schema   string
}

func Load() Config {
	if err := LoadDotEnv(".env"); err != nil {
		fmt.Fprintf(os.Stderr, "warning: .env を読み込めません: %v\n", err)
	}

	return Config{
		HTTPAddr:            valueOrDefault("HTTP_ADDR", ":8080"),
		Environment:         valueOrDefault("APP_ENV", "development"),
		AllowExpoGoRedirect: boolValueOrDefault("ALLOW_EXPO_GO_REDIRECT", false),
		DevClientOrigin:     valueOrDefault("DEV_CLIENT_ORIGIN", "http://127.0.0.1:5173"),
		ClientOrigin:        os.Getenv("CLIENT_ORIGIN"),
		Database: DatabaseConfig{
			Host:     valueOrDefault("DB_HOST", "127.0.0.1"),
			Port:     valueOrDefault("DB_PORT", "5432"),
			Name:     valueOrDefault("DB_NAME", "samurai_meet"),
			User:     valueOrDefault("DB_USER", "samurai_meet_app"),
			Password: os.Getenv("DB_PASSWORD"),
			SSLMode:  valueOrDefault("DB_SSLMODE", "disable"),
			Schema:   valueOrDefault("DB_SCHEMA", "public"),
		},
		ImageStorage: ImageStorageConfig{
			Directory:                    valueOrDefault("IMAGE_STORAGE_DIR", "storage/images"),
			ProfileWrappingPrivateKeyPEM: os.Getenv("PROFILE_WRAPPING_PRIVATE_KEY_PEM"),
			CiphertextCacheMaxBytes:      intValueOrDefault("IMAGE_CIPHERTEXT_CACHE_MAX_BYTES", 256*1024*1024),
			CiphertextCacheTTLSeconds:    intValueOrDefault("IMAGE_CIPHERTEXT_CACHE_TTL_SECONDS", 300),
		},
		GoogleOIDC: GoogleOIDCConfig{os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("GOOGLE_CLIENT_SECRET"), os.Getenv("GOOGLE_REDIRECT_URI")},
		WebAuthn:   WebAuthnConfig{valueOrDefault("WEBAUTHN_RP_ID", "localhost"), valueOrDefault("WEBAUTHN_RP_ORIGIN", "http://localhost:5173"), valueOrDefault("WEBAUTHN_RP_DISPLAY_NAME", "Samurai Meet")},
		JWS:        JWSConfig{os.Getenv("JWS_SIGNING_KEY"), valueOrDefault("JWS_ISSUER", "samurai-meet-api"), valueOrDefault("JWS_AUDIENCE", "samurai-meet-mobile")},
	}
}

func intValueOrDefault(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func boolValueOrDefault(key string, fallback bool) bool {
	value, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

// LoadDotEnv loads a simple KEY=VALUE file without overriding existing
// process environment variables. Secrets remain outside source control.
func LoadDotEnv(path string) error {
	file, err := os.Open(filepath.Clean(path))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			return fmt.Errorf("%s:%d: KEY=VALUE 形式ではありません", path, lineNumber)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
		}
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, value); err != nil {
				return fmt.Errorf("%s:%d: %w", path, lineNumber, err)
			}
		}
	}
	return scanner.Err()
}

func valueOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
