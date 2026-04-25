// Package db owns the PostgreSQL connection pool (pgx) and provides
// health check helpers. sqlc-generated queries (Faz 2 PR-3+) will live in
// internal/db/sqlcgen and use this pool.
package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Config carries the subset of runtime configuration relevant to the pool.
//
// Populated from internal/config (Config.DB*) at startup.
type Config struct {
	URL                 string
	MaxConns            int32
	MinConns            int32
	HealthCheckInterval time.Duration
}

// Validate ensures the pool config is internally consistent before connecting.
func (c Config) Validate() error {
	if c.URL == "" {
		return errors.New("db url is required (set ENVANTER_DB_URL)")
	}
	if c.MinConns < 0 {
		return errors.New("min_conns must be >= 0")
	}
	if c.MaxConns < c.MinConns {
		return fmt.Errorf("max_conns (%d) must be >= min_conns (%d)", c.MaxConns, c.MinConns)
	}
	return nil
}

// New creates a connection pool. Caller is responsible for Close().
//
// Performs an initial Ping to fail fast if the DB is unreachable —
// the API container should not enter Ready state if it cannot reach the DB.
func New(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}

	pcfg, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	pcfg.MaxConns = cfg.MaxConns
	pcfg.MinConns = cfg.MinConns
	if cfg.HealthCheckInterval > 0 {
		pcfg.HealthCheckPeriod = cfg.HealthCheckInterval
	}

	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("initial ping: %w", err)
	}
	return pool, nil
}
