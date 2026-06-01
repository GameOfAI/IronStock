package httpapi

// PR-K8S: Admin endpoints for Kubernetes cluster configuration.
//
// All routes require admin role (enforced by RequireRole middleware in router).
//
// Credentials (ServiceAccount tokens, kubeconfig YAML) are encrypted with the
// master key via crypto.Seal before storage and never returned in plain text.
// The decryptClusterConfig helper is shared with k8s_proxy.go and
// admin_report.go so every handler reads credentials the same way.

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/crypto"
	"envanter.app/server/internal/k8s"
)

// K8sClusterHandlers groups admin K8s cluster management endpoints.
type K8sClusterHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// k8sClusterPublic is the API representation of a cluster (credentials omitted).
type k8sClusterPublic struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	ServerURL     string    `json:"server_url"`
	AuthMode      string    `json:"auth_mode"`
	HasToken      bool      `json:"has_token"`
	HasKubeconfig bool      `json:"has_kubeconfig"`
	CACertPEM     string    `json:"ca_cert_pem,omitempty"`
	SkipTLSVerify bool      `json:"skip_tls_verify"`
	Enabled       bool      `json:"enabled"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// createK8sClusterRequest is the body for POST /api/v1/admin/k8s/clusters.
type createK8sClusterRequest struct {
	Name           string `json:"name"`
	ServerURL      string `json:"server_url"`
	AuthMode       string `json:"auth_mode"`
	Token          string `json:"token,omitempty"`           // plaintext SA token — never persisted
	KubeconfigYAML string `json:"kubeconfig_yaml,omitempty"` // plaintext YAML — never persisted
	CACertPEM      string `json:"ca_cert_pem,omitempty"`
	SkipTLSVerify  bool   `json:"skip_tls_verify"`
	Enabled        bool   `json:"enabled"`
}

// updateK8sClusterRequest is the body for PUT /api/v1/admin/k8s/clusters/{id}.
// Empty credential strings mean "keep existing".
type updateK8sClusterRequest struct {
	Name           string `json:"name"`
	ServerURL      string `json:"server_url"`
	AuthMode       string `json:"auth_mode"`
	Token          string `json:"token,omitempty"`
	KubeconfigYAML string `json:"kubeconfig_yaml,omitempty"`
	CACertPEM      string `json:"ca_cert_pem,omitempty"`
	SkipTLSVerify  bool   `json:"skip_tls_verify"`
	Enabled        bool   `json:"enabled"`
}

// ListClusters implements GET /api/v1/admin/k8s/clusters.
func (h *K8sClusterHandlers) ListClusters(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Service.DB.Query(ctx, `
		SELECT id::text, name, server_url, auth_mode,
		       (token_enc IS NOT NULL AND length(token_enc) > 0)          AS has_token,
		       (kubeconfig_enc IS NOT NULL AND length(kubeconfig_enc) > 0) AS has_kubeconfig,
		       COALESCE(ca_cert_pem, ''), skip_tls_verify, enabled, created_at, updated_at
		FROM k8s_clusters
		ORDER BY name
	`)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Cluster listesi alınamadı.", err)
		return
	}
	defer rows.Close()

	clusters := []k8sClusterPublic{}
	for rows.Next() {
		var c k8sClusterPublic
		if err := rows.Scan(
			&c.ID, &c.Name, &c.ServerURL, &c.AuthMode,
			&c.HasToken, &c.HasKubeconfig, &c.CACertPEM,
			&c.SkipTLSVerify, &c.Enabled, &c.CreatedAt, &c.UpdatedAt,
		); err == nil {
			clusters = append(clusters, c)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"clusters": clusters})
}

// CreateCluster implements POST /api/v1/admin/k8s/clusters.
func (h *K8sClusterHandlers) CreateCluster(w http.ResponseWriter, r *http.Request) {
	var req createK8sClusterRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "name zorunlu.", errors.New("missing name"))
		return
	}
	if req.ServerURL == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "server_url zorunlu.", errors.New("missing server_url"))
		return
	}
	if req.AuthMode != "token" && req.AuthMode != "kubeconfig" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"auth_mode 'token' veya 'kubeconfig' olmalı.", errors.New("invalid auth_mode"))
		return
	}
	if req.AuthMode == "token" && req.Token == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"token modu için token zorunlu.", errors.New("missing token"))
		return
	}
	if req.AuthMode == "kubeconfig" && req.KubeconfigYAML == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"kubeconfig modu için kubeconfig_yaml zorunlu.", errors.New("missing kubeconfig_yaml"))
		return
	}

	// Validate kubeconfig syntax before persisting.
	if req.AuthMode == "kubeconfig" {
		if _, err := k8s.ParseKubeconfig([]byte(req.KubeconfigYAML)); err != nil {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"Kubeconfig geçersiz: "+err.Error(), err)
			return
		}
	}

	ctx := r.Context()
	claims := ClaimsFromContext(ctx)

	// Insert without credentials first to get real ID for AAD.
	var newID string
	err := h.Service.DB.QueryRow(ctx, `
		INSERT INTO k8s_clusters (name, server_url, auth_mode, ca_cert_pem, skip_tls_verify, enabled, created_by)
		VALUES ($1, $2, $3, NULLIF($4,''), $5, $6, $7::uuid)
		RETURNING id::text
	`,
		req.Name, req.ServerURL, req.AuthMode,
		req.CACertPEM, req.SkipTLSVerify, req.Enabled,
		nullableStr(claims.Subject),
	).Scan(&newID)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu isimde bir cluster zaten var.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Cluster oluşturulamadı.", err)
		return
	}

	// Encrypt and store credentials now that we have the real ID.
	if err := h.saveCredentials(ctx, newID, req.AuthMode, req.Token, req.KubeconfigYAML); err != nil {
		h.Logger.Warn("k8s cluster credential encryption failed", slog.String("id", newID), slog.String("error", err.Error()))
	}

	h.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionAdminK8sClusterCreated,
		Details:     map[string]any{"cluster_id": newID, "name": req.Name, "auth_mode": req.AuthMode},
	})
	writeJSON(w, http.StatusCreated, map[string]any{"id": newID})
}

// UpdateCluster implements PUT /api/v1/admin/k8s/clusters/{id}.
func (h *K8sClusterHandlers) UpdateCluster(w http.ResponseWriter, r *http.Request) {
	clusterID := chi.URLParam(r, "id")
	var req updateK8sClusterRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "name zorunlu.", errors.New("missing name"))
		return
	}
	if req.AuthMode != "token" && req.AuthMode != "kubeconfig" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			"auth_mode 'token' veya 'kubeconfig' olmalı.", errors.New("invalid auth_mode"))
		return
	}
	// Validate kubeconfig if new YAML provided.
	if req.AuthMode == "kubeconfig" && req.KubeconfigYAML != "" {
		if _, err := k8s.ParseKubeconfig([]byte(req.KubeconfigYAML)); err != nil {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				"Kubeconfig geçersiz: "+err.Error(), err)
			return
		}
	}

	ctx := r.Context()
	claims := ClaimsFromContext(ctx)

	tag, err := h.Service.DB.Exec(ctx, `
		UPDATE k8s_clusters
		SET name=$2, server_url=$3, auth_mode=$4, ca_cert_pem=NULLIF($5,''), skip_tls_verify=$6, enabled=$7
		WHERE id=$1::uuid
	`,
		clusterID, req.Name, req.ServerURL, req.AuthMode,
		req.CACertPEM, req.SkipTLSVerify, req.Enabled,
	)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, h.Logger, http.StatusConflict, ErrCodeConflict,
				"Bu isimde bir cluster zaten var.", err)
			return
		}
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Cluster güncellenemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Cluster bulunamadı.", errors.New("not found"))
		return
	}

	// Update credentials only if new ones are provided (empty = keep existing).
	if req.Token != "" || req.KubeconfigYAML != "" {
		if err := h.saveCredentials(ctx, clusterID, req.AuthMode, req.Token, req.KubeconfigYAML); err != nil {
			h.Logger.Warn("k8s cluster credential update failed", slog.String("id", clusterID), slog.String("error", err.Error()))
		}
	}

	h.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionAdminK8sClusterUpdated,
		Details:     map[string]any{"cluster_id": clusterID, "name": req.Name},
	})
	w.WriteHeader(http.StatusNoContent)
}

// DeleteCluster implements DELETE /api/v1/admin/k8s/clusters/{id}.
func (h *K8sClusterHandlers) DeleteCluster(w http.ResponseWriter, r *http.Request) {
	clusterID := chi.URLParam(r, "id")
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)

	tag, err := h.Service.DB.Exec(ctx, `DELETE FROM k8s_clusters WHERE id=$1::uuid`, clusterID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Cluster silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Cluster bulunamadı.", errors.New("not found"))
		return
	}

	h.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionAdminK8sClusterDeleted,
		Details:     map[string]any{"cluster_id": clusterID},
	})
	w.WriteHeader(http.StatusNoContent)
}

// TestCluster implements POST /api/v1/admin/k8s/clusters/{id}/test.
// Calls GET /version on the cluster to verify connectivity and credentials.
func (h *K8sClusterHandlers) TestCluster(w http.ResponseWriter, r *http.Request) {
	clusterID := chi.URLParam(r, "id")
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)

	cfg, err := decryptClusterConfig(ctx, h.Service, clusterID)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Cluster bulunamadı.", err)
		return
	}

	client, err := k8s.New(*cfg)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"K8s client oluşturulamadı: "+err.Error(), err)
		return
	}

	version, err := client.GetServerVersion(ctx)
	h.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionAdminK8sClusterTested,
		Details:     map[string]any{"cluster_id": clusterID, "success": err == nil},
	})
	if err != nil {
		writeError(w, h.Logger, http.StatusBadGateway, ErrCodeInternal,
			"Cluster bağlantısı başarısız: "+err.Error(), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version})
}

// ─── saveCredentials ──────────────────────────────────────────────────────────

// saveCredentials encrypts and stores SA token or kubeconfig YAML in the DB.
// Only non-empty strings are processed; the other column is cleared.
func (h *K8sClusterHandlers) saveCredentials(ctx context.Context, clusterID, authMode, token, kubeconfigYAML string) error {
	if authMode == "token" && token != "" {
		aad := crypto.MakeAAD("k8s_clusters", clusterID, "token_enc")
		enc, err := h.Service.Master.Seal([]byte(token), aad)
		if err != nil {
			return err
		}
		_, err = h.Service.DB.Exec(ctx,
			`UPDATE k8s_clusters SET token_enc=$2, kubeconfig_enc=NULL WHERE id=$1::uuid`,
			clusterID, enc)
		return err
	}
	if authMode == "kubeconfig" && kubeconfigYAML != "" {
		aad := crypto.MakeAAD("k8s_clusters", clusterID, "kubeconfig_enc")
		enc, err := h.Service.Master.Seal([]byte(kubeconfigYAML), aad)
		if err != nil {
			return err
		}
		_, err = h.Service.DB.Exec(ctx,
			`UPDATE k8s_clusters SET kubeconfig_enc=$2, token_enc=NULL WHERE id=$1::uuid`,
			clusterID, enc)
		return err
	}
	return nil
}

// ─── decryptClusterConfig ─────────────────────────────────────────────────────

// decryptClusterConfig loads a cluster row from the DB, decrypts its
// credentials, and returns a *k8s.Config ready to pass to k8s.New.
//
// This helper is used by K8sClusterHandlers.TestCluster, K8sHandlers (proxy),
// and ReportHandlers (report generation) so that all callers share the same
// credential resolution path.
func decryptClusterConfig(ctx context.Context, svc *auth.Service, clusterID string) (*k8s.Config, error) {
	var (
		serverURL     string
		authMode      string
		tokenEnc      []byte
		kubeconfigEnc []byte
		caCertPEM     string
		skipTLS       bool
		enabled       bool
	)
	err := svc.DB.QueryRow(ctx, `
		SELECT server_url, auth_mode, token_enc, kubeconfig_enc,
		       COALESCE(ca_cert_pem, ''), skip_tls_verify, enabled
		FROM k8s_clusters
		WHERE id=$1::uuid
		LIMIT 1
	`, clusterID).Scan(
		&serverURL, &authMode, &tokenEnc, &kubeconfigEnc,
		&caCertPEM, &skipTLS, &enabled,
	)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, errors.New("k8s: cluster is disabled")
	}

	cfg := k8s.Config{
		ServerURL:     serverURL,
		AuthMode:      k8s.AuthMode(authMode),
		CACertPEM:     caCertPEM,
		SkipTLSVerify: skipTLS,
	}

	switch k8s.AuthMode(authMode) {
	case k8s.AuthModeToken:
		if len(tokenEnc) == 0 {
			return nil, errors.New("k8s: cluster has no token credential")
		}
		aad := crypto.MakeAAD("k8s_clusters", clusterID, "token_enc")
		plain, err := svc.Master.Open(tokenEnc, aad)
		if err != nil {
			return nil, errors.New("k8s: failed to decrypt cluster token")
		}
		cfg.BearerToken = string(plain)

	case k8s.AuthModeKubeconfig:
		if len(kubeconfigEnc) == 0 {
			return nil, errors.New("k8s: cluster has no kubeconfig credential")
		}
		aad := crypto.MakeAAD("k8s_clusters", clusterID, "kubeconfig_enc")
		plain, err := svc.Master.Open(kubeconfigEnc, aad)
		if err != nil {
			return nil, errors.New("k8s: failed to decrypt cluster kubeconfig")
		}
		parsed, err := k8s.ParseKubeconfig(plain)
		if err != nil {
			return nil, err
		}
		cfg.Kubeconfig = parsed
		// Kubeconfig-derived server URL takes precedence if set.
		if parsed.ServerURL != "" {
			cfg.ServerURL = parsed.ServerURL
		}

	default:
		return nil, errors.New("k8s: unknown auth_mode: " + authMode)
	}

	return &cfg, nil
}
