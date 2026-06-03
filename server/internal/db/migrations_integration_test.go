//go:build integration

// Integration test: real Postgres via testcontainers-go.
// Build: go test -tags=integration ./internal/db/...
//
// Requires Docker. CI runs this in 'server-integration' job.
package db_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	pgImage      = "postgres:16-alpine"
	pgDB         = "envanter_test"
	pgUser       = "envanter"
	pgPass       = "envanter_test_pass"
	startTimeout = 60 * time.Second
)

// startPostgres spins up a Postgres 16 container. Caller defers Terminate.
//
// testcontainers-go v0.30.0 API: postgres.RunContainer(ctx, opts...) — image
// passed via testcontainers.WithImage. (postgres.Run with positional image arg
// was introduced in v0.31+.)
func startPostgres(ctx context.Context, t *testing.T) (*postgres.PostgresContainer, string) {
	t.Helper()
	c, err := postgres.RunContainer(ctx,
		testcontainers.WithImage(pgImage),
		postgres.WithDatabase(pgDB),
		postgres.WithUsername(pgUser),
		postgres.WithPassword(pgPass),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(startTimeout),
		),
	)
	if err != nil {
		t.Fatalf("postgres container start: %v", err)
	}
	connStr, err := c.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	return c, connStr
}

// migrate applies migrations in `direction`. dir = "up" | "down".
func migrate(t *testing.T, connStr, direction string) {
	t.Helper()
	migrationsDir, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatalf("abs migrations path: %v", err)
	}
	conn, err := sql.Open("pgx", connStr)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer conn.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}

	switch direction {
	case "up":
		if err := goose.Up(conn, migrationsDir); err != nil {
			t.Fatalf("goose up: %v", err)
		}
	case "down":
		if err := goose.DownTo(conn, migrationsDir, 0); err != nil {
			t.Fatalf("goose down to 0: %v", err)
		}
	default:
		t.Fatalf("unknown direction: %s", direction)
	}
}

// TestMigrations_UpDownUp verifies all migrations apply, reverse cleanly,
// and re-apply. Validates seed counts after final up.
func TestMigrations_UpDownUp(t *testing.T) {
	if testing.Short() {
		t.Skip("integration tests skipped in short mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	c, connStr := startPostgres(ctx, t)
	defer func() {
		if err := c.Terminate(ctx); err != nil {
			t.Logf("container terminate: %v", err)
		}
	}()

	t.Log("Phase 1: goose up")
	migrate(t, connStr, "up")

	t.Log("Phase 2: goose down to 0")
	migrate(t, connStr, "down")

	t.Log("Phase 3: goose up again (idempotency)")
	migrate(t, connStr, "up")

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	// Expected tables (17): users, roles, user_roles, sessions, audit_log,
	// master_keys, user_keypairs, totp_secrets, recovery_codes,
	// item_types, field_definitions, folders, folder_permissions,
	// items, item_fields, item_shares, item_relationships.
	// Plus goose_db_version (goose's own bookkeeping) = 18 total.
	var tableCount int
	const tableQuery = `
		SELECT count(*) FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
	`
	if err := pool.QueryRow(ctx, tableQuery).Scan(&tableCount); err != nil {
		t.Fatalf("count tables: %v", err)
	}
	const minExpectedTables = 17
	if tableCount < minExpectedTables {
		t.Errorf("expected >= %d tables, got %d", minExpectedTables, tableCount)
	}

	// Seed validation: roles seeded with 3 (read, write, admin).
	var roleCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM roles").Scan(&roleCount); err != nil {
		t.Fatalf("count roles: %v", err)
	}
	if roleCount != 3 {
		t.Errorf("roles seeded count = %d, want 3", roleCount)
	}

	// Seed validation: 9 item_types (8 from 00010 + k8s_namespace from 00045).
	var itemTypeCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM item_types").Scan(&itemTypeCount); err != nil {
		t.Fatalf("count item_types: %v", err)
	}
	if itemTypeCount != 9 {
		t.Errorf("item_types seeded count = %d, want 9", itemTypeCount)
	}

	// Seed validation: at least 25 field_definitions (we seed ~30).
	var fieldDefCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM field_definitions").Scan(&fieldDefCount); err != nil {
		t.Fatalf("count field_definitions: %v", err)
	}
	const minFieldDefs = 25
	if fieldDefCount < minFieldDefs {
		t.Errorf("field_definitions seeded count = %d, want >= %d", fieldDefCount, minFieldDefs)
	}

	// Spot-check: hostname + environment + criticality field_definitions exist.
	var fieldKeys []string
	rows, err := pool.Query(ctx,
		"SELECT key FROM field_definitions WHERE key IN ('hostname','environment','criticality') ORDER BY key")
	if err != nil {
		t.Fatalf("query field keys: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatalf("scan: %v", err)
		}
		fieldKeys = append(fieldKeys, k)
	}
	if len(fieldKeys) != 3 {
		t.Errorf("expected 3 spot-check field keys, got %d: %v", len(fieldKeys), fieldKeys)
	}

	// Sanity: enum field has allowed_values.
	var allowedJSON []byte
	err = pool.QueryRow(ctx,
		"SELECT allowed_values FROM field_definitions WHERE key = 'environment'").Scan(&allowedJSON)
	if err != nil {
		t.Fatalf("query environment allowed_values: %v", err)
	}
	if len(allowedJSON) == 0 {
		t.Error("environment field_definition allowed_values is empty (should be enum array)")
	}
}
