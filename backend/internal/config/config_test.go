package config

import (
	"os"
	"path/filepath"
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
