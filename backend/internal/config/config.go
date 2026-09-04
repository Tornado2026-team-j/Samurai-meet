package config

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/url"
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
	DemoAccountEnabled  bool
	GoogleLoginEnabled  bool
	DevClientOrigin     string
	ClientOrigin        string
	Database            DatabaseConfig
	ImageStorage        ImageStorageConfig
	GoogleOIDC          GoogleOIDCConfig
	Gemini              GeminiConfig
	Stripe              StripeConfig
	WebAuthn            WebAuthnConfig
	JWS                 JWSConfig
	Chat                ChatConfig
}

// ChatConfig tunes chat message send rate limiting, translation provider
// budgets, moderation fallback, and retention. Translation limits are
// account-scoped because the provider cost follows the authenticated account
// rather than its IP address.
type ChatConfig struct {
	SendBurst                         int
	SendRefillPerMinute               int
	TranslationAccountBurst           int
	TranslationAccountRefillPerMinute int
	TranslationMaxInFlight            int
	DevelopmentModerationFreeMode     bool
	MessageRetentionDays              int
}

type GoogleOIDCConfig struct{ ClientID, ClientSecret, RedirectURI string }
type GeminiConfig struct{ APIKey, Model, ImageModel string }
type StripeConfig struct{ SecretKey, IdentityWebhookSecret, IdentityReturnURL string }
type WebAuthnConfig struct{ RPID, RPOrigin, RPDisplayName string }
type JWSConfig struct{ SigningKey, KeyID, VerifyKeys, Issuer, Audience string }

type ImageStorageConfig struct {
	Directory                    string
	ProfileWrappingPrivateKeyPEM string
	ProfileWrappingKeyVersion    string
	CiphertextCacheMaxBytes      int
	CiphertextCacheTTLSeconds    int
	MaxUploadBytes               int
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

// ValidateForEnvironment fails closed for production-like deployments. A
// server with a missing signing key or an unprotected network database
// transport must not start a partially working authentication service. The
// single-host deployment may use a loopback-only PostgreSQL connection when
// PostgreSQL TLS is not enabled.
func (c Config) ValidateForEnvironment() error {
	environment := strings.ToLower(strings.TrimSpace(c.Environment))
	production := environment == "production" || environment == "prod"
	if c.DemoAccountEnabled && !production {
		var demoProblems []string
		if c.GoogleLoginEnabled {
			demoProblems = append(demoProblems, "GOOGLE_LOGIN_ENABLED must be false when DEMO_ACCOUNT_ENABLED is true")
		}
		if databaseName := strings.TrimSpace(c.Database.Name); databaseName == "" || databaseName == "samurai_meet" {
			demoProblems = append(demoProblems, "DB_NAME must point to a separated demo database")
		}
		if imageDir := strings.TrimSpace(c.ImageStorage.Directory); imageDir == "" || imageDir == "storage/images" {
			demoProblems = append(demoProblems, "IMAGE_STORAGE_DIR must point to separated demo storage")
		}
		if strings.TrimSpace(c.JWS.SigningKey) == "" {
			demoProblems = append(demoProblems, "JWS_SIGNING_KEY must be a separated demo signing key")
		}
		if len(demoProblems) > 0 {
			return fmt.Errorf("demo configuration is unsafe: %s", strings.Join(demoProblems, ", "))
		}
	}

	if !production {
		return nil
	}
	var missing []string
	if strings.TrimSpace(c.JWS.SigningKey) == "" {
		missing = append(missing, "JWS_SIGNING_KEY")
	}
	if strings.TrimSpace(c.JWS.KeyID) == "" {
		missing = append(missing, "JWS_KEY_ID")
	}
	if strings.TrimSpace(c.JWS.Issuer) == "" {
		missing = append(missing, "JWS_ISSUER")
	}
	if strings.TrimSpace(c.JWS.Audience) == "" {
		missing = append(missing, "JWS_AUDIENCE")
	}
	if !validSecureOrigin(c.ClientOrigin) {
		missing = append(missing, "CLIENT_ORIGIN (https origin)")
	}
	if strings.TrimSpace(c.Database.Password) == "" {
		missing = append(missing, "DB_PASSWORD")
	}
	if !secureDatabaseTransport(c.Database) {
		missing = append(missing, "DB_SSLMODE (TLS required unless DB_HOST is loopback)")
	}
	if strings.TrimSpace(c.GoogleOIDC.ClientID) == "" || strings.TrimSpace(c.GoogleOIDC.ClientSecret) == "" || !validSecureURL(c.GoogleOIDC.RedirectURI) {
		missing = append(missing, "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI")
	}
	if strings.TrimSpace(c.ImageStorage.ProfileWrappingPrivateKeyPEM) == "" {
		missing = append(missing, "PROFILE_WRAPPING_PRIVATE_KEY_PEM")
	}
	if !validSecureOrigin(c.WebAuthn.RPOrigin) || strings.TrimSpace(c.WebAuthn.RPID) == "" {
		missing = append(missing, "WEBAUTHN_RP_ID/WEBAUTHN_RP_ORIGIN (https origin)")
	}
	if len(missing) > 0 {
		return fmt.Errorf("production configuration is incomplete: %s", strings.Join(missing, ", "))
	}
	return nil
}

func validSecureOrigin(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil &&
		(parsed.Path == "" || parsed.Path == "/") && parsed.RawQuery == "" && parsed.Fragment == ""
}

func validSecureURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && parsed.Path == "/auth/callback" && parsed.RawQuery == "" && parsed.Fragment == ""
}

func secureSSLMode(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "require", "verify-ca", "verify-full":
		return true
	default:
		return false
	}
}

// secureDatabaseTransport accepts a plaintext PostgreSQL connection only when
// the database is explicitly on the same host. Production deployments using a
// network database must still use TLS; this exception is for the supported
// single-host deployment where the database is not reachable through the
// tunnel or a network interface.
func secureDatabaseTransport(database DatabaseConfig) bool {
	if secureSSLMode(database.SSLMode) {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(database.SSLMode), "disable") && isLoopbackHost(database.Host)
}

func isLoopbackHost(value string) bool {
	host := strings.TrimSpace(value)
	if strings.EqualFold(host, "localhost") {
		return true
	}
	host = strings.Trim(host, "[]")
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func Load() Config {
	if err := LoadDotEnv(".env"); err != nil {
		fmt.Fprintf(os.Stderr, "warning: .env を読み込めません: %v\n", err)
	}

	return Config{
		HTTPAddr:            valueOrDefault("HTTP_ADDR", ":8080"),
		Environment:         valueOrDefault("APP_ENV", "development"),
		AllowExpoGoRedirect: boolValueOrDefault("ALLOW_EXPO_GO_REDIRECT", false),
		DemoAccountEnabled:  boolValueOrDefault("DEMO_ACCOUNT_ENABLED", false),
		GoogleLoginEnabled:  boolValueOrDefault("GOOGLE_LOGIN_ENABLED", true),
		DevClientOrigin:     valueOrDefault("DEV_CLIENT_ORIGIN", "http://localhost:8081"),
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
			ProfileWrappingKeyVersion:    valueOrDefault("PROFILE_WRAPPING_KEY_VERSION", "v1"),
			CiphertextCacheMaxBytes:      intValueOrDefault("IMAGE_CIPHERTEXT_CACHE_MAX_BYTES", 256*1024*1024),
			CiphertextCacheTTLSeconds:    intValueOrDefault("IMAGE_CIPHERTEXT_CACHE_TTL_SECONDS", 300),
			MaxUploadBytes:               intValueOrDefault("IMAGE_MAX_UPLOAD_BYTES", 20*1024*1024),
		},
		GoogleOIDC: GoogleOIDCConfig{os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("GOOGLE_CLIENT_SECRET"), os.Getenv("GOOGLE_REDIRECT_URI")},
		Gemini:     GeminiConfig{os.Getenv("GEMINI_API_KEY"), valueOrDefault("GEMINI_MODEL", "gemini-3.1-flash-lite"), valueOrDefault("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-lite-image")},
		Stripe:     StripeConfig{os.Getenv("STRIPE_SECRET_KEY"), os.Getenv("STRIPE_IDENTITY_WEBHOOK_SECRET"), os.Getenv("STRIPE_IDENTITY_RETURN_URL")},
		WebAuthn:   WebAuthnConfig{valueOrDefault("WEBAUTHN_RP_ID", "localhost"), valueOrDefault("WEBAUTHN_RP_ORIGIN", "http://localhost:8081"), valueOrDefault("WEBAUTHN_RP_DISPLAY_NAME", "Samurai Meet")},
		JWS:        JWSConfig{os.Getenv("JWS_SIGNING_KEY"), valueOrDefault("JWS_KEY_ID", "v1"), os.Getenv("JWS_VERIFY_KEYS"), valueOrDefault("JWS_ISSUER", "samurai-meet-api"), valueOrDefault("JWS_AUDIENCE", "samurai-meet-mobile")},
		Chat: ChatConfig{
			SendBurst:                         intValueOrDefault("CHAT_SEND_BURST", 15),
			SendRefillPerMinute:               intValueOrDefault("CHAT_SEND_REFILL_PER_MINUTE", 60),
			TranslationAccountBurst:           intValueOrDefault("CHAT_TRANSLATION_ACCOUNT_BURST", 30),
			TranslationAccountRefillPerMinute: intValueOrDefault("CHAT_TRANSLATION_ACCOUNT_REFILL_PER_MINUTE", 30),
			TranslationMaxInFlight:            intValueOrDefault("CHAT_TRANSLATION_MAX_IN_FLIGHT", 2),
			DevelopmentModerationFreeMode:     boolValueOrDefault("CHAT_MODERATION_DEV_FREE_MODE", false),
			MessageRetentionDays:              intValueOrDefault("CHAT_MESSAGE_RETENTION_DAYS", 180),
		},
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
