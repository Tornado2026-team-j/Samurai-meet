package config

import "os"

// Config contains the process-level settings required before external services
// such as PostgreSQL, Google OAuth, and Passkey are connected.
type Config struct {
	HTTPAddr    string
	Environment string
}

func Load() Config {
	return Config{
		HTTPAddr:    valueOrDefault("HTTP_ADDR", ":8080"),
		Environment: valueOrDefault("APP_ENV", "development"),
	}
}

func valueOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
