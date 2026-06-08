// Envanter App API server entrypoint.
//
// Faz 2 PR-5: master key bootstrap + auth.Service + register/TOTP endpoints
// alongside the existing chi router + DB pool foundation. Login, refresh,
// item CRUD come in PR-6+.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/cache"
	"envanter.app/server/internal/clientcert"
	"envanter.app/server/internal/config"
	"envanter.app/server/internal/db"
	"envanter.app/server/internal/email"
	"envanter.app/server/internal/geoip"
	"envanter.app/server/internal/httpapi"
	"envanter.app/server/internal/llm"
	"envanter.app/server/internal/logfwd"
	"envanter.app/server/internal/logging"
	"envanter.app/server/internal/notify"
	"envanter.app/server/internal/storage"
	"envanter.app/server/internal/vault"
	webauthnpkg "envanter.app/server/internal/webauthn"
	"envanter.app/server/internal/ws"
)

// version is set via -ldflags at build time; defaults to "dev" for local builds.
var version = "dev"

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
	if cfg.BootstrapEnabled {
		logger.Warn("BOOTSTRAP MODE ENABLED — /api/v1/auth/bootstrap is active (TOTP bypassed)")
	}

	// --- Built-in Client CA bootstrap (PR-SEC3) ---
	// Idempotent: creates the IronStock built-in CA exactly once.
	// The CA private key is AES-256-GCM encrypted with the master key.
	if err := clientcert.EnsureBuiltinCA(rootCtx, pool, authSvc.Master); err != nil {
		// Non-fatal: the server still starts; admins can't issue certs until the CA exists.
		// On the next restart it will be created. Log at Warn so ops can see it.
		logger.Warn("built-in client CA bootstrap failed — cert issuance unavailable",
			slog.String("error", err.Error()))
	} else {
		logger.Info("built-in client CA ready")
	}

	// --- Redis client (PR-SCALE, optional) ---
	// When ENVANTER_REDIS_URL is set, a shared Redis client is created for:
	//   • WebSocket pub/sub (cross-pod event fan-out)
	//   • Ticket store (one-time WS upgrade tokens)
	//   • Rate limiter (optional, selected by ENVANTER_RATE_LIMIT_BACKEND=redis)
	// Falls back gracefully to in-memory when Redis is unavailable (circuit breaker).
	var redisClient *cache.Client
	if cfg.RedisURL != "" {
		rc, err := cache.New(cfg.RedisURL, cfg.RedisPassword, logger)
		if err != nil {
			// Misconfigured URL — non-fatal; single-pod mode continues.
			logger.Warn("redis: init failed — falling back to single-pod mode",
				slog.String("error", err.Error()))
		} else if rc != nil {
			redisClient = rc
			defer func() { _ = redisClient.Close() }()
			logger.Info("redis: client ready", slog.String("url", cfg.RedisURL))
			httpapi.SetOIDCStateRedis(rc)
		}
	} else {
		logger.Info("redis not configured — single-pod WebSocket mode")
	}

	// --- WebSocket hub + ticket store ---
	// When Redis is configured, use multi-pod mode (pub/sub fan-out + Redis ticket store).
	// Pod ID is used to suppress self-echo of pub/sub messages.
	podID := fmt.Sprintf("%s-%d", mustHostname(), os.Getpid())
	var hub *ws.Hub
	var tickets *ws.TicketStore
	if redisClient != nil {
		hub = ws.NewHubWithRedis(logger, redisClient, podID)
		tickets = ws.NewTicketStoreWithRedis(redisClient)
		logger.Info("ws: using Redis pub/sub hub", slog.String("pod_id", podID))
	} else {
		hub = ws.NewHub(logger)
		tickets = ws.NewTicketStore()
		logger.Info("ws: using single-pod in-memory hub")
	}
	defer hub.Close()
	// TicketStore in-memory cleanup (no-op when Redis is primary, but safe to run).
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-rootCtx.Done():
				return
			case <-ticker.C:
				tickets.Cleanup()
			}
		}
	}()

	// --- Notification writer (PR-N8) ---
	// Declared before authHandlers (break-glass alerting, PR-N4) and
	// background goroutines (expiry scanner).
	notifyWriter := notify.New(pool, hub, logger)

	// --- Email client (PR-NOTIFY, optional — nil if SMTP not configured) ---
	var emailClient *email.Client
	if cfg.SMTPHost != "" {
		emailCfg := email.Config{
			Host:     cfg.SMTPHost,
			Port:     cfg.SMTPPort,
			Username: cfg.SMTPUser,
			Password: cfg.SMTPPassword,
			From:     cfg.SMTPFrom,
			TLSMode:  email.TLSMode(cfg.SMTPTLSMode),
			AppURL:   cfg.AppURL,
		}
		var emailErr error
		emailClient, emailErr = email.New(emailCfg, pool, logger)
		if emailErr != nil {
			// Template parse hatası kritik değil; log edip devam et
			logger.Warn("email client init failed — email notifications disabled",
				slog.String("error", emailErr.Error()))
		} else {
			logger.Info("smtp email client ready",
				slog.String("host", cfg.SMTPHost),
				slog.Int("port", cfg.SMTPPort),
			)
		}
	} else {
		logger.Info("smtp not configured — email notifications disabled")
	}

	// --- WebAuthn service (PR-SEC4, optional — nil if RPID not set) ---
	var waService *webauthnpkg.WAService
	if cfg.WebAuthnRPID != "" {
		waSvc, waErr := webauthnpkg.New(webauthnpkg.Config{
			RPID:          cfg.WebAuthnRPID,
			RPDisplayName: cfg.WebAuthnRPDisplayName,
			RPOrigins:     cfg.WebAuthnRPOrigins,
		}, pool)
		if waErr != nil {
			logger.Warn("webauthn service init failed — WebAuthn disabled",
				slog.String("error", waErr.Error()))
		} else {
			waService = waSvc
			logger.Info("webauthn service ready",
				slog.String("rpid", cfg.WebAuthnRPID),
				slog.Any("origins", cfg.WebAuthnRPOrigins),
			)
		}
	} else {
		logger.Info("webauthn not configured (ENVANTER_WEBAUTHN_RPID not set) — endpoints return 501")
	}

	// --- GeoIP background refresh (PR-SEC5) ---
	// Downloads Tor exit list and caches country lookups. Fail-open: if the
	// initial download fails, the empty set is used (no Tor blocking until first
	// successful refresh). ctx passed so shutdown cancels the goroutine.
	geoip.StartBackgroundRefresh(rootCtx, logger)
	logger.Info("geoip: Tor exit list refresh goroutine started")

	// --- Auth handlers ---
	// Constructed after hub + notifyWriter so break-glass alerts (PR-N4) work.
	authHandlers := &httpapi.AuthHandlers{
		Service:          authSvc,
		Audit:            auditWriter,
		Logger:           logger,
		BootstrapEnabled: cfg.BootstrapEnabled,
		Hub:              hub,
		Notify:           notifyWriter,
		EmailClient:      emailClient,
		AppURL:           cfg.AppURL,
		PasswordResetTTL: cfg.PasswordResetTTL,
		WebAuthn:         waService,
		Redis:            redisClient,
	}

	// --- Credential expiry scanner (PR-N1 + PR-N8) ---
	// Runs every hour, finds items expiring within 7 days:
	//   1. Publishes item.expiry_warning WS events (cache-bust for all clients).
	//   2. Writes a notification row for the item owner (PR-N8).
	// The notification is idempotent-ish: we check that no unread expiry_warning
	// notification already exists for this item today before inserting.
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		// Fetch item id + owner; skip items that already have an unread
		// expiry_warning notification sent today to avoid spam.
		const expirySQL = `
			SELECT i.id::text, i.created_by::text,
			       EXTRACT(DAY FROM (i.expires_at - now()))::int AS days_left
			FROM items i
			WHERE i.expires_at IS NOT NULL
			  AND i.expires_at > now()
			  AND i.expires_at <= now() + INTERVAL '7 days'
			  AND NOT EXISTS (
			      SELECT 1 FROM notifications n
			      WHERE n.user_id = i.created_by
			        AND n.resource_id = i.id
			        AND n.type = 'expiry_warning'
			        AND n.created_at >= now() - INTERVAL '23 hours'
			  )
		`
		scan := func() {
			scanCtx, scanCancel := context.WithTimeout(rootCtx, 30*time.Second)
			defer scanCancel()
			rows, err := pool.Query(scanCtx, expirySQL)
			if err != nil {
				logger.Warn("expiry scan query failed", slog.String("error", err.Error()))
				return
			}
			defer rows.Close()
			count := 0
			for rows.Next() {
				var itemID, userID string
				var daysLeft int
				if err := rows.Scan(&itemID, &userID, &daysLeft); err != nil {
					continue
				}
				// Publish WS cache-bust (no secret data — just UUID).
				hub.Publish(ws.NewEvent(ws.EventItemExpiryWarning, itemID, "system"))
				// Write in-app notification for the owner.
				title := fmt.Sprintf("Kimlik bilgisi %d gün içinde sona eriyor", daysLeft)
				if daysLeft <= 1 {
					title = "Kimlik bilgisi bugün sona eriyor!"
				}
				notifyWriter.WriteAsync(notify.Entry{
					UserID:       userID,
					Type:         "expiry_warning",
					Title:        title,
					Body:         "Kimlik bilgisini güncelleyin veya rotasyon yapın.",
					ResourceType: "item",
					ResourceID:   itemID,
				})
				count++
			}
			if count > 0 {
				logger.Info("expiry scan: items nearing expiry", slog.Int("count", count))
			}
		}
		for {
			select {
			case <-rootCtx.Done():
				return
			case <-ticker.C:
				scan()
			}
		}
	}()

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
	// PR-SEARCH: Backfill name_plain for existing items (runs once, exits when done).
	go httpapi.RunItemNameBackfill(rootCtx, authSvc, logger)

	adminHandlers := &httpapi.AdminHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	// PR-SEC3: client certificate management handler.
	clientCertHandlers := &httpapi.ClientCertHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	groupHandlers := &httpapi.GroupHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	tagHandlers := &httpapi.TagHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	notificationHandlers := &httpapi.NotificationHandlers{
		Service: authSvc,
		Logger:  logger,
		Audit:   auditWriter,
	}
	graphHandlers := &httpapi.GraphHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
		Hub:     hub,
	}
	systemInfoHandlers := &httpapi.SystemInfoHandlers{
		DB:      pool,
		Hub:     hub,
		Logger:  logger,
		Version: version,
	}
	catalogBrowseHandlers := &httpapi.CatalogBrowseHandlers{
		DB:      pool,
		AuthSvc: authSvc, // for folder name decryption
		Logger:  logger,
	}
	catalogHandlers := &httpapi.CatalogHandlers{
		Service: authSvc,
		Logger:  logger,
	}
	lifecycleHandlers := &httpapi.LifecycleHandlers{
		Service: authSvc,
		Logger:  logger,
	}
	pipelineHandlers := &httpapi.PipelineHandlers{
		Service: authSvc,
		Logger:  logger,
	}
	wsHandlers := &httpapi.WSHandlers{
		Service:        authSvc,
		Hub:            hub,
		Tickets:        tickets,
		Logger:         logger,
		AllowedOrigins: cfg.WSAllowedOrigins,
	}

	// --- Log forwarding manager (PR-LOG1) ---
	// Loads enabled configs from DB, starts a goroutine per forwarder.
	// The manager implements audit.Publisher so every committed audit entry is
	// fanned out to all active forwarders.
	logFwdManager := logfwd.NewManager(logger)
	{
		rows, err := pool.Query(rootCtx, `
			SELECT id::text, target_type, config
			FROM log_forwarding_configs
			WHERE enabled = true
		`)
		if err != nil {
			logger.Warn("log forwarding: failed to load configs", slog.String("error", err.Error()))
		} else {
			defer rows.Close()
			for rows.Next() {
				var id, targetType string
				var config []byte
				if err := rows.Scan(&id, &targetType, &config); err != nil {
					logger.Warn("log forwarding: scan error", slog.String("error", err.Error()))
					continue
				}
				f, err := logfwd.BuildForwarder(id, targetType, config)
				if err != nil {
					logger.Warn("log forwarding: build error", slog.String("id", id), slog.String("error", err.Error()))
					continue
				}
				if f != nil {
					logFwdManager.Add(f)
				}
			}
		}
	}
	auditWriter.SetPublisher(logFwdManager)
	logForwardingHandlers := &httpapi.LogForwardingHandlers{
		DB:      pool,
		Audit:   auditWriter,
		Manager: logFwdManager,
		Logger:  logger,
	}
	exportHandlers := &httpapi.ExportHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}

	// --- MinIO storage (optional — attachment routes disabled if not configured) ---
	var attachmentHandlers *httpapi.AttachmentHandlers
	if cfg.MinioAccessKey != "" && cfg.MinioSecretKey != "" {
		minioBackend, err := storage.NewMinioBackend(
			cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioUseSSL,
		)
		if err != nil {
			return fmt.Errorf("minio: %w", err)
		}
		if err := minioBackend.EnsureBucket(rootCtx, cfg.MinioBucket); err != nil {
			logger.Warn("minio bucket ensure failed — attachments disabled",
				slog.String("bucket", cfg.MinioBucket),
				slog.String("error", err.Error()),
			)
		} else {
			attachmentHandlers = &httpapi.AttachmentHandlers{
				Service: authSvc,
				Storage: minioBackend,
				Bucket:  cfg.MinioBucket,
				Logger:  logger,
			}
			logger.Info("minio storage ready", slog.String("bucket", cfg.MinioBucket))
		}
	} else {
		logger.Info("minio credentials not set — attachment endpoints disabled")
	}

	// --- Seed default admin (first-run only) ---
	if err := ensureDefaultAdmin(rootCtx, authSvc, auditWriter, cfg, logger); err != nil {
		return fmt.Errorf("ensure default admin: %w", err)
	}

	ssoHandlers := &httpapi.SSOHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}

	shareLinkHandlers := &httpapi.ShareLinkHandlers{
		DB:      pool,
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}

	// --- HashiCorp Vault client (PR-VAULT, ADR-0007) ---
	// Optional integration: all three ENVANTER_VAULT_* vars must be set.
	// When not configured, Vault-backed items return 503 on vault-fetch.
	vaultClient := vault.New(vault.Config{
		Addr:      cfg.VaultAddr,
		RoleID:    cfg.VaultRoleID,
		SecretID:  cfg.VaultSecretID,
		Namespace: cfg.VaultNamespace,
	})
	if vault.IsNil(vaultClient) {
		logger.Info("vault not configured — Vault-backed items will return 503")
	} else {
		logger.Info("vault configured", slog.String("addr", cfg.VaultAddr))
	}
	vaultHandlers := &httpapi.VaultHandlers{
		Service: authSvc,
		Vault:   vaultClient,
		Audit:   auditWriter,
		Logger:  logger,
	}

	// --- K8s handlers (PR-K8S) ---
	k8sClusterHandlers := &httpapi.K8sClusterHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	k8sHandlers := &httpapi.K8sHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}
	reportHandlers := &httpapi.ReportHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}

	// --- Template handlers (PR-TPL) ---
	templateHandlers := &httpapi.TemplateHandlers{
		Service: authSvc,
		Audit:   auditWriter,
		Logger:  logger,
	}

	// --- AI suggestion handlers (PR-AI) ---
	var llmClient *llm.Client
	if cfg.LLMProvider != "" {
		if c, err := llm.New(cfg.LLMProvider, cfg.LLMAPIKey, cfg.LLMBaseURL, cfg.LLMModel); err != nil {
			logger.Warn("LLM client init failed — AI suggestions disabled", "err", err)
		} else {
			llmClient = c
			logger.Info("LLM provider configured", "provider", cfg.LLMProvider, "model", cfg.LLMModel)
		}
	}
	aiSuggestionHandlers := &httpapi.AISuggestionHandlers{
		ItemH: itemHandlers,
		LLM:   llmClient,
	}

	// --- Ansible + API token handlers (PR-ANSIBLE) ---
	ansibleHandlers := &httpapi.AnsibleInventoryHandlers{ItemH: itemHandlers}
	apiTokenHandlers := &httpapi.APITokenHandlers{ItemH: itemHandlers}

	// --- Secret scanning handler (PR-SCAN) ---
	scanHandlers := &httpapi.ScanHandlers{
		DB:     pool,
		Audit:  auditWriter,
		Logger: logger,
		JWT:    authSvc.JWT,
	}

	// --- SCIM 2.0 handler (PR-SCIM) ---
	scimHandlers := &httpapi.SCIMHandlers{
		DB:     pool,
		Audit:  auditWriter,
		Logger: logger,
	}

	// --- HTTP layer ---
	router := httpapi.NewRouter(httpapi.Deps{
		Logger:        logger,
		DB:            pool,
		Auth:          authHandlers,
		Folder:        folderHandlers,
		Item:          itemHandlers,
		Attachment:    attachmentHandlers,
		Admin:         adminHandlers,
		ClientCert:    clientCertHandlers, // PR-SEC3
		SSO:           ssoHandlers,        // PR-LDAP
		Group:         groupHandlers,
		Tag:           tagHandlers,
		Notification:  notificationHandlers,
		Graph:         graphHandlers,
		LogForwarding: logForwardingHandlers, // PR-LOG1
		Catalog:       catalogHandlers,
		WS:            wsHandlers,
		ShareLink:     shareLinkHandlers,
		Lifecycle:     lifecycleHandlers,
		Pipeline:      pipelineHandlers,
		Export:        exportHandlers,
		Vault:         vaultHandlers,        // PR-VAULT
		K8sCluster:    k8sClusterHandlers,   // PR-K8S
		K8s:           k8sHandlers,          // PR-K8S
		Report:        reportHandlers,       // PR-K8S
		Template:      templateHandlers,     // PR-TPL
		AISuggestion:  aiSuggestionHandlers, // PR-AI
		Ansible:       ansibleHandlers,      // PR-ANSIBLE
		APIToken:      apiTokenHandlers,     // PR-ANSIBLE
		SCIM:          scimHandlers,         // PR-SCIM
		Scan:          scanHandlers,         // PR-SCAN
		SystemInfo:    systemInfoHandlers,
		CatalogBrowse: catalogBrowseHandlers, // PR-CATALOG
		CORSOrigins:   cfg.CORSOrigins,       // ENVANTER_CORS_ORIGINS
		PprofEnabled:  cfg.PprofEnabled,      // PR-PROD5
	})

	if cfg.PprofEnabled {
		logger.Warn("pprof debug endpoints enabled at /debug/pprof/ — disable in production")
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
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
	logFwdManager.StopAll()
	logger.Info("shutdown complete")
	return nil
}

// mustHostname returns the OS hostname or "unknown" on failure.
// Used to build a unique pod ID for Redis pub/sub self-echo suppression.
func mustHostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

// ensureDefaultAdmin creates a default admin user on the very first startup
// if no user with the 'admin' role exists.
//
// The created user:
//   - username: "admin", email: "admin@localhost"
//   - status: active, must_change_password: true
//   - role: admin
//   - password: ENVANTER_DEFAULT_ADMIN_PASSWORD env var, or random if unset
//
// A random password is printed to stdout ONCE — this is intentional.
// The operator must change it immediately (the UI enforces this via
// must_change_password = true which blocks all routes until changed).
//
// This is NOT the bootstrap mechanism (ADR-0010). Bootstrap is for
// emergency access. ensureDefaultAdmin is for first-run convenience.
func ensureDefaultAdmin(
	ctx context.Context,
	svc *auth.Service,
	aw *audit.Writer,
	cfg *config.Config,
	logger *slog.Logger,
) error {
	// Check whether any admin user already exists.
	var adminCount int
	err := svc.DB.QueryRow(ctx, `
		SELECT count(*)
		FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		WHERE r.name = 'admin'
	`).Scan(&adminCount)
	if err != nil {
		return fmt.Errorf("count admin users: %w", err)
	}
	if adminCount > 0 {
		// Admin already exists — nothing to do.
		return nil
	}

	// Determine password.
	password := cfg.DefaultAdminPassword
	if password == "" {
		// Generate a random 16-byte (32 hex char) temporary password.
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return fmt.Errorf("generate random password: %w", err)
		}
		password = hex.EncodeToString(b)
		fmt.Printf("\n"+
			"╔══════════════════════════════════════════════════════╗\n"+
			"║          VARSAYILAN ADMİN ŞİFRESİ (tek seferlik)    ║\n"+
			"║                                                      ║\n"+
			"║  Kullanıcı adı: admin                                ║\n"+
			"║  Şifre:         %-36s║\n"+
			"║                                                      ║\n"+
			"║  İlk girişten sonra şifrenizi değiştirmeniz          ║\n"+
			"║  zorunludur. Bu şifreyi güvende tutun.               ║\n"+
			"╚══════════════════════════════════════════════════════╝\n\n",
			password+" ",
		)
	}

	hp, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	tx, err := svc.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Check for existing user named "admin" (edge case: admin user without role).
	var existingID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE username = 'admin' LIMIT 1`).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("check existing admin user: %w", err)
	}

	var userID string
	if existingID != "" {
		// User exists without admin role — just grant admin role below.
		userID = existingID
	} else {
		// Create the admin user.
		// PR-SEC1: totp_required=true explicit — bootstrap admin must enroll TOTP
		// after the forced password change on first login.
		err = tx.QueryRow(ctx, `
			INSERT INTO users (username, email, password_hash, argon2_params, status, must_change_password, totp_required)
			VALUES ('admin', 'admin@localhost', $1, $2, 'active', true, true)
			RETURNING id::text
		`, hp.Hash, hp.ParamsJSON).Scan(&userID)
		if err != nil {
			return fmt.Errorf("insert admin user: %w", err)
		}

		// Persist Argon2 salt inside argon2_params jsonb (same pattern as
		// httpapi.persistArgon2Salt — duplicated here to avoid a circular import).
		// Must be base64 — extractSaltFromParams uses base64.StdEncoding.DecodeString.
		saltB64 := base64.StdEncoding.EncodeToString(hp.Salt)
		if _, err := tx.Exec(ctx, `
			UPDATE users
			SET argon2_params = argon2_params || jsonb_build_object('salt_b64', $2::text)
			WHERE id = $1::uuid
		`, userID, saltB64); err != nil {
			return fmt.Errorf("persist argon2 salt: %w", err)
		}

		// Placeholder keypair (same as admin-created user pattern).
		placeholderKEKParams := []byte(`{"alg":"none","note":"seed-admin-placeholder"}`)
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_keypairs (user_id, public_key, private_key_enc, kek_salt, kek_params)
			VALUES ($1, $2, $3, $4, $5)
		`, userID, make([]byte, 32), make([]byte, 1), make([]byte, 16), placeholderKEKParams); err != nil {
			return fmt.Errorf("insert placeholder keypair: %w", err)
		}
	}

	// Grant admin role.
	if _, err := tx.Exec(ctx, `
		INSERT INTO user_roles (user_id, role_id)
		SELECT $1::uuid, r.id FROM roles r WHERE r.name = 'admin'
		ON CONFLICT DO NOTHING
	`, userID); err != nil {
		return fmt.Errorf("grant admin role: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	_ = aw.Write(ctx, audit.Entry{
		ActorUserID:  "",
		Action:       audit.ActionAuthBootstrapSetup, // closest semantic; dedicated constant Faz 6'da
		ResourceType: audit.ResourceUser,
		ResourceID:   userID,
		Details:      map[string]any{"note": "seed default admin created on first run"},
	})

	logger.Info("seed default admin created",
		slog.String("username", "admin"),
		slog.String("user_id", userID),
		slog.Bool("must_change_password", true),
		slog.Bool("password_from_env", strings.TrimSpace(cfg.DefaultAdminPassword) != ""),
	)
	return nil
}
