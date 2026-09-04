package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDotEnvLoadsUnsetValuesWithoutOverridingEnvironment(t *testing.T) {
	t.Setenv("CONFIG_TEST_EXISTING", "from-environment")
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("CONFIG_TEST_EXISTING=from-file\nCONFIG_TEST_NEW=quoted value\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Unsetenv("CONFIG_TEST_NEW") })

	if err := LoadDotEnv(path); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("CONFIG_TEST_EXISTING"); got != "from-environment" {
		t.Fatalf("existing value = %q", got)
	}
	if got := os.Getenv("CONFIG_TEST_NEW"); got != "quoted value" {
		t.Fatalf("new value = %q", got)
	}
}

func TestLoadDotEnvRejectsInvalidLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("not-an-assignment\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := LoadDotEnv(path); err == nil {
		t.Fatal("LoadDotEnv() error = nil, want error")
	}
}

func TestLoadReadsSeparateDatabaseSettings(t *testing.T) {
	t.Setenv("DB_HOST", "db.internal")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "samurai_meet_test")
	t.Setenv("DB_USER", "test_user")
	t.Setenv("DB_PASSWORD", "test_password")
	t.Setenv("DB_SCHEMA", "app")

	cfg := Load()
	if got := cfg.Database; got.Host != "db.internal" || got.Port != "5433" || got.Name != "samurai_meet_test" || got.User != "test_user" || got.Password != "test_password" || got.Schema != "app" {
		t.Fatalf("Database = %+v", got)
	}
}

func TestLoadReadsAdditionalClientOrigins(t *testing.T) {
	t.Setenv("ADDITIONAL_CLIENT_ORIGINS", " https://samurai-meet-expo-go-pre.disnana.com/ , https://samurai-meet-staging.disnana.com ")

	cfg := Load()
	got := strings.Join(cfg.AdditionalClientOrigins, ",")
	if got != "https://samurai-meet-expo-go-pre.disnana.com/,https://samurai-meet-staging.disnana.com" {
		t.Fatalf("AdditionalClientOrigins = %q", got)
	}
}

func TestLoadReadsDemoReviewSwitches(t *testing.T) {
	t.Setenv("DEMO_ACCOUNT_ENABLED", "true")
	t.Setenv("GOOGLE_LOGIN_ENABLED", "false")

	cfg := Load()
	if !cfg.DemoAccountEnabled {
		t.Fatal("DEMO_ACCOUNT_ENABLED=true was not loaded")
	}
	if cfg.GoogleLoginEnabled {
		t.Fatal("GOOGLE_LOGIN_ENABLED=false was not loaded")
	}
}

func TestProductionValidationFailsClosed(t *testing.T) {
	cfg := Config{Environment: "production"}
	if err := cfg.ValidateForEnvironment(); err == nil {
		t.Fatal("production configuration with missing secrets should fail")
	}
}

func TestProductionValidationAcceptsCompleteSecureConfiguration(t *testing.T) {
	cfg := completeProductionConfig()
	if err := cfg.ValidateForEnvironment(); err != nil {
		t.Fatalf("complete production configuration rejected: %v", err)
	}
}

func TestProductionValidationAllowsExplicitModerationFreeModeForTemporaryTesting(t *testing.T) {
	cfg := completeProductionConfig()
	cfg.Chat.DevelopmentModerationFreeMode = true
	if err := cfg.ValidateForEnvironment(); err != nil {
		t.Fatalf("explicit moderation free mode should remain an acknowledged production exception: %v", err)
	}
}

func TestProductionValidationRejectsInsecureAdditionalClientOrigin(t *testing.T) {
	cfg := completeProductionConfig()
	cfg.AdditionalClientOrigins = []string{"http://samurai-meet-expo-go-pre.disnana.com"}

	err := cfg.ValidateForEnvironment()
	if err == nil || !strings.Contains(err.Error(), "ADDITIONAL_CLIENT_ORIGINS") {
		t.Fatalf("insecure additional client origin error = %v", err)
	}
}

func TestProductionValidationAllowsExplicitDemoAccounts(t *testing.T) {
	cfg := completeProductionConfig()
	cfg.DemoAccountEnabled = true
	cfg.GoogleLoginEnabled = true
	cfg.Database.Name = "samurai_meet"
	cfg.ImageStorage.Directory = "storage/images"
	if err := cfg.ValidateForEnvironment(); err != nil {
		t.Fatalf("explicit production demo configuration rejected: %v", err)
	}
}

func TestDemoValidationRequiresSeparatedReviewEnvironment(t *testing.T) {
	cfg := Config{
		Environment:        "review",
		DemoAccountEnabled: true,
		GoogleLoginEnabled: true,
		Database:           DatabaseConfig{Name: "samurai_meet"},
		ImageStorage:       ImageStorageConfig{Directory: "storage/images"},
	}
	err := cfg.ValidateForEnvironment()
	if err == nil {
		t.Fatal("unsafe demo configuration should fail")
	}
	for _, want := range []string{
		"GOOGLE_LOGIN_ENABLED must be false",
		"DB_NAME must point to a separated demo database",
		"IMAGE_STORAGE_DIR must point to separated demo storage",
		"JWS_SIGNING_KEY must be a separated demo signing key",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("demo validation error %q does not contain %q", err.Error(), want)
		}
	}
}

func TestDemoValidationAcceptsSeparatedReviewEnvironment(t *testing.T) {
	cfg := Config{
		Environment:        "review",
		DemoAccountEnabled: true,
		GoogleLoginEnabled: false,
		Database:           DatabaseConfig{Name: "samurai_meet_demo"},
		ImageStorage:       ImageStorageConfig{Directory: "storage/demo-images"},
		JWS:                JWSConfig{SigningKey: "demo-signing-key"},
	}
	if err := cfg.ValidateForEnvironment(); err != nil {
		t.Fatalf("separated demo configuration rejected: %v", err)
	}
}

func completeProductionConfig() Config {
	return Config{
		Environment:  "production",
		ClientOrigin: "https://samurai-meet.disnana.com",
		Database:     DatabaseConfig{Password: "db-password", SSLMode: "verify-full"},
		GoogleOIDC:   GoogleOIDCConfig{ClientID: "client", ClientSecret: "secret", RedirectURI: "https://samurai-meet.disnana.com/auth/callback"},
		WebAuthn:     WebAuthnConfig{RPID: "samurai-meet.disnana.com", RPOrigin: "https://samurai-meet.disnana.com"},
		JWS:          JWSConfig{SigningKey: "encoded-key", KeyID: "v1", Issuer: "issuer", Audience: "audience"},
		ImageStorage: ImageStorageConfig{ProfileWrappingPrivateKeyPEM: "injected-secret"},
	}
}

func TestProductionValidationAcceptsLoopbackDatabaseWithoutTLS(t *testing.T) {
	cfg := Config{
		Environment:  "production",
		ClientOrigin: "https://samurai-meet.disnana.com",
		Database:     DatabaseConfig{Host: "127.0.0.1", Password: "db-password", SSLMode: "disable"},
		GoogleOIDC:   GoogleOIDCConfig{ClientID: "client", ClientSecret: "secret", RedirectURI: "https://samurai-meet.disnana.com/auth/callback"},
		WebAuthn:     WebAuthnConfig{RPID: "samurai-meet.disnana.com", RPOrigin: "https://samurai-meet.disnana.com"},
		JWS:          JWSConfig{SigningKey: "encoded-key", KeyID: "v1", Issuer: "issuer", Audience: "audience"},
		ImageStorage: ImageStorageConfig{ProfileWrappingPrivateKeyPEM: "injected-secret"},
	}
	if err := cfg.ValidateForEnvironment(); err != nil {
		t.Fatalf("loopback production configuration rejected: %v", err)
	}
}

func TestProductionValidationAcceptsExplicitExpoGoRedirect(t *testing.T) {
	cfg := Config{
		Environment:         "production",
		AllowExpoGoRedirect: true,
		ClientOrigin:        "https://samurai-meet.disnana.com",
		Database:            DatabaseConfig{Host: "db.internal", Password: "db-password", SSLMode: "verify-full"},
		GoogleOIDC:          GoogleOIDCConfig{ClientID: "client", ClientSecret: "secret", RedirectURI: "https://samurai-meet.disnana.com/auth/callback"},
		WebAuthn:            WebAuthnConfig{RPID: "samurai-meet.disnana.com", RPOrigin: "https://samurai-meet.disnana.com"},
		JWS:                 JWSConfig{SigningKey: "encoded-key", KeyID: "v1", Issuer: "issuer", Audience: "audience"},
		ImageStorage:        ImageStorageConfig{ProfileWrappingPrivateKeyPEM: "injected-secret"},
	}
	if err := cfg.ValidateForEnvironment(); err != nil {
		t.Fatalf("explicit Expo Go redirect configuration rejected: %v", err)
	}
}

func TestProductionValidationRejectsPlaintextNetworkDatabase(t *testing.T) {
	cfg := Config{
		Environment:  "production",
		ClientOrigin: "https://samurai-meet.disnana.com",
		Database:     DatabaseConfig{Host: "db.internal", Password: "db-password", SSLMode: "disable"},
		GoogleOIDC:   GoogleOIDCConfig{ClientID: "client", ClientSecret: "secret", RedirectURI: "https://samurai-meet.disnana.com/auth/callback"},
		WebAuthn:     WebAuthnConfig{RPID: "samurai-meet.disnana.com", RPOrigin: "https://samurai-meet.disnana.com"},
		JWS:          JWSConfig{SigningKey: "encoded-key", KeyID: "v1", Issuer: "issuer", Audience: "audience"},
		ImageStorage: ImageStorageConfig{ProfileWrappingPrivateKeyPEM: "injected-secret"},
	}
	if err := cfg.ValidateForEnvironment(); err == nil {
		t.Fatal("plaintext network database should be rejected in production")
	}
}

func TestProductionValidationRejectsInsecureOriginsAndDatabase(t *testing.T) {
	cfg := Config{
		Environment:  "production",
		ClientOrigin: "http://samurai-meet.disnana.com",
		Database:     DatabaseConfig{Password: "db-password", SSLMode: "disable"},
		GoogleOIDC:   GoogleOIDCConfig{ClientID: "client", ClientSecret: "secret", RedirectURI: "http://samurai-meet.disnana.com/auth/callback"},
		WebAuthn:     WebAuthnConfig{RPID: "samurai-meet.disnana.com", RPOrigin: "http://samurai-meet.disnana.com"},
		JWS:          JWSConfig{SigningKey: "encoded-key", KeyID: "v1", Issuer: "issuer", Audience: "audience"},
		ImageStorage: ImageStorageConfig{ProfileWrappingPrivateKeyPEM: "injected-secret"},
	}
	if err := cfg.ValidateForEnvironment(); err == nil {
		t.Fatal("insecure production configuration should fail")
	}
}
