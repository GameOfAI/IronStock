// Package config loads and validates runtime configuration from environment
// variables (ENVANTER_*) and applies sensible defaults. Errors are returned
// instead of panicking so the entrypoint can decide on exit semantics.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config aggregates all runtime configuration.
//
// All fields are populated from ENVANTER_<UPPER_SNAKE_CASE> environment
// variables. Defaults apply when env is unset or empty.
type Config struct {
	// HTTP server
	Addr            string        // ENVANTER_ADDR (default ":8080")
	ShutdownTimeout time.Duration // ENVANTER_SHUTDOWN_TIMEOUT (default 10s)

	// Logging
	LogLevel  string // ENVANTER_LOG_LEVEL: debug|info|warn|error (default "info")
	LogFormat string // ENVANTER_LOG_FORMAT: json|text (default "json")

	// Database (used by Faz 2 PR-2 onwards; validation tolerates missing for now)
	DBURL                 string        // ENVANTER_DB_URL
	DBMaxConns            int32         // ENVANTER_DB_MAX_CONNS (default 10)
	DBMinConns            int32         // ENVANTER_DB_MIN_CONNS (default 2)
	DBHealthCheckInterval time.Duration // ENVANTER_DB_HEALTH_CHECK_INTERVAL (default 30s)
}

// Load reads config from environment, applies defaults, and validates.
func Load() (*Config, error) {
	cfg := &Config{
		Addr:                  envOr("ENVANTER_ADDR", ":8080"),
		ShutdownTimeout:       envDurationOr("ENVANTER_SHUTDOWN_TIMEOUT", 10*time.Second),
		LogLevel:              strings.ToLower(envOr("ENVANTER_LOG_LEVEL", "info")),
		LogFormat:             strings.ToLower(envOr("ENVANTER_LOG_FORMAT", "json")),
		DBURL:                 os.Getenv("ENVANTER_DB_URL"),
		DBMaxConns:            envInt32Or("ENVANTER_DB_MAX_CONNS", 10),
		DBMinConns:            envInt32Or("ENVANTER_DB_MIN_CONNS", 2),
		DBHealthCheckInterval: envDurationOr("ENVANTER_DB_HEALTH_CHECK_INTERVAL", 30*time.Second),
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Validate ensures the loaded config is internally consistent.
//
// Note: ENVANTER_DB_URL is NOT required at this point — it becomes required
// once internal/db is wired in PR-2. Keeping it optional here lets early
// foundation tests run without a DB.
func (c *Config) Validate() error {
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return fmt.Errorf("invalid ENVANTER_LOG_LEVEL: %q (allowed: debug, info, warn, error)", c.LogLevel)
	}
	switch c.LogFormat {
	case "json", "text":
	default:
		return fmt.Errorf("invalid ENVANTER_LOG_FORMAT: %q (allowed: json, text)", c.LogFormat)
	}
	if c.DBMinConns < 0 {
		return errors.New("ENVANTER_DB_MIN_CONNS must be >= 0")
	}
	if c.DBMaxConns < c.DBMinConns {
		return fmt.Errorf("ENVANTER_DB_MAX_CONNS (%d) must be >= ENVANTER_DB_MIN_CONNS (%d)",
			c.DBMaxConns, c.DBMinConns)
	}
	if c.ShutdownTimeout <= 0 {
		return errors.New("ENVANTER_SHUTDOWN_TIMEOUT must be > 0")
	}
	return nil
}

// ----- helpers -----

func envOr(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// envInt32Or parses an int32 from env (bitSize=32 → no overflow risk).
// Used for DB pool sizes (pgxpool expects int32).
func envInt32Or(key string, def int32) int32 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 32); err == nil {
			return int32(n)
		}
	}
	return def
}

func envDurationOr(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
