package db

import (
	"strings"
	"testing"
	"time"
)

func TestConfig_Validate(t *testing.T) {
	cases := []struct {
		name    string
		cfg     Config
		wantErr string
	}{
		{
			name:    "missing url",
			cfg:     Config{MaxConns: 10, MinConns: 2},
			wantErr: "db url is required",
		},
		{
			name:    "negative min",
			cfg:     Config{URL: "postgres://x", MinConns: -1, MaxConns: 10},
			wantErr: "min_conns",
		},
		{
			name:    "max less than min",
			cfg:     Config{URL: "postgres://x", MinConns: 5, MaxConns: 2},
			wantErr: "max_conns",
		},
		{
			name: "valid",
			cfg: Config{
				URL:      "postgres://envanter:pass@localhost:5432/envanter?sslmode=disable",
				MinConns: 2, MaxConns: 10,
				HealthCheckInterval: 30 * time.Second,
			},
		},
		{
			name: "valid with zero min and zero healthcheck",
			cfg: Config{
				URL: "postgres://x", MinConns: 0, MaxConns: 1,
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.cfg.Validate()
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("expected nil err, got: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error = %q, want containing %q", err.Error(), tc.wantErr)
			}
		})
	}
}

// Note: TestNew_Connects (live DB integration test) is intentionally omitted
// from this PR. testcontainers-go integration tests come with PR-3+ when
// migration code exercises actual queries. Foundation tests here are
// pure unit (config validation, no network).
