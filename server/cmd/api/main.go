// Envanter App API server entrypoint.
//
// Faz 2 PR-2: chi router + middleware + pgx pool + DB health check.
// Auth and inventory endpoints come in PR-3+.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"envanter.app/server/internal/config"
	"envanter.app/server/internal/db"
	"envanter.app/server/internal/httpapi"
	"envanter.app/server/internal/logging"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	logger := logging.New(cfg.LogLevel, cfg.LogFormat)
	slog.SetDefault(logger)

	logger.Info("envanter-api starting",
		slog.String("addr", cfg.Addr),
		slog.String("log_level", cfg.LogLevel),
		slog.String("log_format", cfg.LogFormat),
	)

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- DB pool ---
	logger.Info("connecting to database",
		slog.Int("max_conns", int(cfg.DBMaxConns)),
		slog.Int("min_conns", int(cfg.DBMinConns)),
	)
	pool, err := db.New(rootCtx, db.Config{
		URL:                 cfg.DBURL,
		MaxConns:            cfg.DBMaxConns,
		MinConns:            cfg.DBMinConns,
		HealthCheckInterval: cfg.DBHealthCheckInterval,
	})
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer pool.Close()
	logger.Info("database connected")

	// --- HTTP layer ---
	router := httpapi.NewRouter(httpapi.Deps{
		Logger: logger,
		DB:     pool,
	})

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// --- Lifecycle ---
	serverErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-stop:
		logger.Info("shutdown initiated", slog.String("signal", sig.String()))
	case err := <-serverErr:
		logger.Error("server failed", slog.String("error", err.Error()))
		return err
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", slog.String("error", err.Error()))
		return err
	}
	logger.Info("shutdown complete")
	return nil
}
