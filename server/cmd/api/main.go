// Envanter App API server entrypoint.
//
// Faz 2 PR-5: master key bootstrap + auth.Service + register/TOTP endpoints
// alongside the existing chi router + DB pool foundation. Login, refresh,
// item CRUD come in PR-6+.
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

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/config"
	"envanter.app/server/internal/db"
	"envanter.app/server/internal/httpapi"
	"envanter.app/server/internal/logging"
	"envanter.app/server/internal/ws"
)

const issuerName = "Envanter"

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
	if err := cfg.RequireSecrets(); err != nil {
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

	// --- Master key bootstrap ---
	mkState, err := auth.BootstrapMasterKey(rootCtx, pool, cfg.MasterKey)
	if err != nil {
		return fmt.Errorf("master key bootstrap: %w", err)
	}
	logger.Info("master key bootstrapped",
		slog.Int("master_key_id", int(mkState.ID)),
		slog.Int("version", int(mkState.Version)),
	)

	// --- Auth service + handlers ---
	authSvc, err := auth.New(auth.ServiceConfig{
		DB:         pool,
		MasterKey:  mkState,
		JWTSecret:  cfg.JWTSecret,
		IssuerName: issuerName,
	})
	if err != nil {
		return fmt.Errorf("auth service: %w", err)
	}
	auditWriter := audit.NewWriter(pool)
	authHandlers := &httpapi.AuthHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	// --- WebSocket hub (created early so handlers can attach Publish) ---
	hub := ws.NewHub(logger)
	defer hub.Close()

	folderHandlers := &httpapi.FolderHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
		Hub:     hub,
	}
	itemHandlers := &httpapi.ItemHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
		Hub:     hub,
	}
	adminHandlers := &httpapi.AdminHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	catalogHandlers := &httpapi.CatalogHandlers{
		Service: authSvc,
		Logger:  logger,
	}
	wsHandlers := &httpapi.WSHandlers{
		Service: authSvc,
		Hub:     hub,
		Logger:  logger,
	}

	// --- HTTP layer ---
	router := httpapi.NewRouter(httpapi.Deps{
		Logger:  logger,
		DB:      pool,
		Auth:    authHandlers,
		Folder:  folderHandlers,
		Item:    itemHandlers,
		Admin:   adminHandlers,
		Catalog: catalogHandlers,
		WS:      wsHandlers,
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
