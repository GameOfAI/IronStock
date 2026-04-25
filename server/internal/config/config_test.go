package config

import (
	"strings"
	"testing"
	"time"
)

// resetEnv clears all ENVANTER_* vars within the test scope.
func resetEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		"ENVANTER_ADDR",
		"ENVANTER_SHUTDOWN_TIMEOUT",
		"ENVANTER_LOG_LEVEL",
		"ENVANTER_LOG_FORMAT",
		"ENVANTER_DB_URL",
		"ENVANTER_DB_MAX_CONNS",
		"ENVANTER_DB_MIN_CONNS",
		"ENVANTER_DB_HEALTH_CHECK_INTERVAL",
		"ENVANTER_MASTER_KEY",
		"ENVANTER_JWT_SECRET",
	}
	for _, k := range keys {
		t.Setenv(k, "")
	}
}

func TestLoad_AppliesDefaults(t *testing.T) {
	resetEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Addr != ":8080" {
		t.Errorf("Addr default = %q, want %q", cfg.Addr, ":8080")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel default = %q, want %q", cfg.LogLevel, "info")
	}
	if cfg.LogFormat != "json" {
		t.Errorf("LogFormat default = %q, want %q", cfg.LogFormat, "json")
	}
	if cfg.ShutdownTimeout != 10*time.Second {
		t.Errorf("ShutdownTimeout = %v, want %v", cfg.ShutdownTimeout, 10*time.Second)
	}
	if cfg.DBMaxConns != 10 {
		t.Errorf("DBMaxConns default = %d, want 10", cfg.DBMaxConns)
	}
	if cfg.DBMinConns != 2 {
		t.Errorf("DBMinConns default = %d, want 2", cfg.DBMinConns)
	}
}

func TestLoad_RespectsEnv(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_ADDR", "0.0.0.0:9090")
	t.Setenv("ENVANTER_LOG_LEVEL", "debug")
	t.Setenv("ENVANTER_LOG_FORMAT", "text")
	t.Setenv("ENVANTER_SHUTDOWN_TIMEOUT", "5s")
	t.Setenv("ENVANTER_DB_URL", "postgres://test/test")
	t.Setenv("ENVANTER_DB_MAX_CONNS", "50")
	t.Setenv("ENVANTER_DB_MIN_CONNS", "5")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Addr != "0.0.0.0:9090" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, "0.0.0.0:9090")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want debug", cfg.LogLevel)
	}
	if cfg.LogFormat != "text" {
		t.Errorf("LogFormat = %q, want text", cfg.LogFormat)
	}
	if cfg.ShutdownTimeout != 5*time.Second {
		t.Errorf("ShutdownTimeout = %v, want 5s", cfg.ShutdownTimeout)
	}
	if cfg.DBURL != "postgres://test/test" {
		t.Errorf("DBURL = %q", cfg.DBURL)
	}
	if cfg.DBMaxConns != 50 || cfg.DBMinConns != 5 {
		t.Errorf("DB conns = (%d, %d), want (50, 5)", cfg.DBMaxConns, cfg.DBMinConns)
	}
}

func TestLoad_LogLevelCaseInsensitive(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_LOG_LEVEL", "DEBUG")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want lowercased 'debug'", cfg.LogLevel)
	}
}

func TestValidate_RejectsBadLogLevel(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_LOG_LEVEL", "trace")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid log level")
	}
	if !strings.Contains(err.Error(), "ENVANTER_LOG_LEVEL") {
		t.Errorf("error should reference env var: %v", err)
	}
}

func TestValidate_RejectsBadLogFormat(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_LOG_FORMAT", "yaml")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid log format")
	}
}

func TestValidate_RejectsMaxLessThanMin(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_DB_MIN_CONNS", "20")
	t.Setenv("ENVANTER_DB_MAX_CONNS", "5")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when max < min")
	}
	if !strings.Contains(err.Error(), "ENVANTER_DB_MAX_CONNS") {
		t.Errorf("error should mention the offending var: %v", err)
	}
}

func TestValidate_RejectsNegativeMinConns(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_DB_MIN_CONNS", "-1")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for negative min conns")
	}
}

func TestValidate_RejectsZeroShutdownTimeout(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_SHUTDOWN_TIMEOUT", "0s")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for zero shutdown timeout")
	}
}

func TestEnvDurationOr_FallsBackOnInvalid(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_SHUTDOWN_TIMEOUT", "not-a-duration")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected fallback to default, got error: %v", err)
	}
	if cfg.ShutdownTimeout != 10*time.Second {
		t.Errorf("expected default 10s on invalid duration, got %v", cfg.ShutdownTimeout)
	}
}

func TestLoad_MasterKey_DecodedAndValidated(t *testing.T) {
	resetEnv(t)
	// 32 zero bytes base64-encoded
	t.Setenv("ENVANTER_MASTER_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(cfg.MasterKey) != 32 {
		t.Errorf("MasterKey len = %d, want 32", len(cfg.MasterKey))
	}
}

func TestLoad_MasterKey_RejectsBadBase64(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_MASTER_KEY", "!!!not-base64!!!")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid base64")
	}
}

func TestLoad_MasterKey_RejectsWrongLength(t *testing.T) {
	resetEnv(t)
	// 16 bytes, base64-encoded → wrong length (need 32)
	t.Setenv("ENVANTER_MASTER_KEY", "AAAAAAAAAAAAAAAAAAAAAA==")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for 16-byte master key (need 32)")
	}
}

func TestLoad_JWTSecret_RejectsTooShort(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_JWT_SECRET", "short")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for short JWT secret")
	}
}

func TestLoad_JWTSecret_AcceptsExactly32Bytes(t *testing.T) {
	resetEnv(t)
	t.Setenv("ENVANTER_JWT_SECRET", "01234567890123456789012345678901") // 32 chars
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(cfg.JWTSecret) != 32 {
		t.Errorf("JWTSecret len = %d, want 32", len(cfg.JWTSecret))
	}
}

func TestRequireSecrets(t *testing.T) {
	cases := []struct {
		name    string
		mk, jwt []byte
		wantErr bool
	}{
		{"both set", make([]byte, 32), make([]byte, 32), false},
		{"missing mk", nil, make([]byte, 32), true},
		{"missing jwt", make([]byte, 32), nil, true},
		{"short jwt", make([]byte, 32), make([]byte, 16), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &Config{MasterKey: tc.mk, JWTSecret: tc.jwt}
			err := cfg.RequireSecrets()
			if (err != nil) != tc.wantErr {
				t.Errorf("RequireSecrets err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}
