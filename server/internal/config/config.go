// Package config loads and validates runtime configuration from environment
// variables (ENVANTER_*) and applies sensible defaults. Errors are returned
// instead of panicking so the entrypoint can decide on exit semantics.
package config

import (
	"encoding/base64"
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

	// Cryptographic secrets (sensitive — never logged in plaintext, internal/logging
	// redaction is the safety net but callers should still avoid printing).
	// Both required once internal/auth is wired (PR-5+); optional during
	// foundation tests (gated by NeedsAuth in Validate).

	// MasterKey is the 32-byte symmetric key for envelope encryption (ADR-0004 §2).
	// Provided via ENVANTER_MASTER_KEY as base64 (44 chars). Decoded length must be 32.
	MasterKey []byte
	// JWTSecret is the HMAC key for HS256 access tokens (and tmp tokens for TOTP
	// enrollment / recovery). Provided via ENVANTER_JWT_SECRET, raw bytes; >= 32 bytes
	// required for HS256 security (RFC 7518 §3.2).
	JWTSecret []byte

	// MinIO / S3-compatible object storage (PR-A2: item attachments)
	MinioEndpoint  string // ENVANTER_MINIO_ENDPOINT (default "minio:9000")
	MinioAccessKey string // ENVANTER_MINIO_ACCESS_KEY
	MinioSecretKey string // ENVANTER_MINIO_SECRET_KEY
	MinioUseSSL    bool   // ENVANTER_MINIO_USE_SSL (default false)
	MinioBucket    string // ENVANTER_MINIO_BUCKET (default "envanter")

	// BootstrapEnabled enables POST /api/v1/auth/bootstrap — a TOTP-free
	// Basic-Auth login for admin users who are locked out. Default false.
	// Enable only temporarily during bootstrap/recovery ops (ADR-0010).
	BootstrapEnabled bool // ENVANTER_BOOTSTRAP_ENABLED (default false)

	// DefaultAdminPassword is used by ensureDefaultAdmin() at startup.
	// If unset and no admin user exists, a random password is generated and
	// printed to stdout ONCE. Set this for repeatable deployments.
	// ENVANTER_DEFAULT_ADMIN_PASSWORD — optional.
	DefaultAdminPassword string // ENVANTER_DEFAULT_ADMIN_PASSWORD

	// WSAllowedOrigins is a comma-separated list of glob patterns passed to
	// coder/websocket AcceptOptions.OriginPatterns.
	// Default "localhost:*,127.0.0.1:*" (dev-only).
	// Production MUST set ENVANTER_WS_ALLOWED_ORIGINS to the real frontend
	// origin, e.g. "app.example.com,*.example.com".
	WSAllowedOrigins []string // ENVANTER_WS_ALLOWED_ORIGINS

	// HashiCorp Vault integration (PR-VAULT, ADR-0007).
	// All three fields must be set for Vault to be enabled.
	// When unset, Vault-backed items return "vault not configured" error.
	VaultAddr      string // ENVANTER_VAULT_ADDR       — e.g. "https://vault.cluster.local:8200"
	VaultRoleID    string // ENVANTER_VAULT_ROLE_ID    — AppRole role_id
	VaultSecretID  string // ENVANTER_VAULT_SECRET_ID  — AppRole secret_id
	VaultNamespace string // ENVANTER_VAULT_NAMESPACE  — Vault Enterprise namespace (optional)
}

// Load reads config from environment, applies defaults, and validates.
func Load() (*Config, error) {
	masterKey, err := decodeMasterKey(os.Getenv("ENVANTER_MASTER_KEY"))
	if err != nil {
		return nil, err
	}
	cfg := &Config{
		Addr:                  envOr("ENVANTER_ADDR", ":8080"),
		ShutdownTimeout:       envDurationOr("ENVANTER_SHUTDOWN_TIMEOUT", 10*time.Second),
		LogLevel:              strings.ToLower(envOr("ENVANTER_LOG_LEVEL", "info")),
		LogFormat:             strings.ToLower(envOr("ENVANTER_LOG_FORMAT", "json")),
		DBURL:                 os.Getenv("ENVANTER_DB_URL"),
		DBMaxConns:            envInt32Or("ENVANTER_DB_MAX_CONNS", 10),
		DBMinConns:            envInt32Or("ENVANTER_DB_MIN_CONNS", 2),
		DBHealthCheckInterval: envDurationOr("ENVANTER_DB_HEALTH_CHECK_INTERVAL", 30*time.Second),
		MasterKey:             masterKey,
		JWTSecret:             []byte(os.Getenv("ENVANTER_JWT_SECRET")),
		MinioEndpoint:         envOr("ENVANTER_MINIO_ENDPOINT", "minio:9000"),
		MinioAccessKey:        os.Getenv("ENVANTER_MINIO_ACCESS_KEY"),
		MinioSecretKey:        os.Getenv("ENVANTER_MINIO_SECRET_KEY"),
		MinioUseSSL:           envBoolOr("ENVANTER_MINIO_USE_SSL", false),
		MinioBucket:           envOr("ENVANTER_MINIO_BUCKET", "envanter"),
		BootstrapEnabled:      envBoolOr("ENVANTER_BOOTSTRAP_ENABLED", false),
		DefaultAdminPassword:  os.Getenv("ENVANTER_DEFAULT_ADMIN_PASSWORD"),
		WSAllowedOrigins:      envStringSliceOr("ENVANTER_WS_ALLOWED_ORIGINS", []string{"localhost:*", "127.0.0.1:*"}),
		VaultAddr:             os.Getenv("ENVANTER_VAULT_ADDR"),
		VaultRoleID:           os.Getenv("ENVANTER_VAULT_ROLE_ID"),
		VaultSecretID:         os.Getenv("ENVANTER_VAULT_SECRET_ID"),
		VaultNamespace:        os.Getenv("ENVANTER_VAULT_NAMESPACE"),
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// decodeMasterKey decodes the base64-encoded master key from env. Empty input
// returns nil (validation will catch it where required).
func decodeMasterKey(b64 string) ([]byte, error) {
	if b64 == "" {
		return nil, nil
	}
	key, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("invalid ENVANTER_MASTER_KEY (must be base64): %w", err)
	}
	return key, nil
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
	// MasterKey + JWTSecret are not required at config-load time so foundation
	// tests can run without env. internal/auth.New verifies them at startup.
	if len(c.MasterKey) > 0 && len(c.MasterKey) != 32 {
		return fmt.Errorf("ENVANTER_MASTER_KEY decoded length = %d, want 32", len(c.MasterKey))
	}
	if len(c.JWTSecret) > 0 && len(c.JWTSecret) < 32 {
		return fmt.Errorf("ENVANTER_JWT_SECRET length = %d, want >= 32 (HS256 security)", len(c.JWTSecret))
	}
	return nil
}

// RequireSecrets returns an error if MasterKey or JWTSecret is unset.
// Called by internal/auth bootstrap; not by Load (which is permissive so
// non-auth tests can run).
func (c *Config) RequireSecrets() error {
	if len(c.MasterKey) != 32 {
		return errors.New("ENVANTER_MASTER_KEY is required (32-byte base64)")
	}
	if len(c.JWTSecret) < 32 {
		return errors.New("ENVANTER_JWT_SECRET is required (>= 32 bytes)")
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

func envBoolOr(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

// envStringSliceOr splits the env value on commas and trims each element.
// Returns def when the variable is unset or empty.
func envStringSliceOr(key string, def []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	parts := strings.Split(v, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	if len(result) == 0 {
		return def
	}
	return result
}
