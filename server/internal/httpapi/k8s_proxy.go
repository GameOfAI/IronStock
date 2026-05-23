package httpapi

// PR-K8S: Per-item live Kubernetes data proxy endpoints.
//
// Security model (same as vault_handlers.go):
//   - Caller must have item Read permission (or admin) to fetch live K8s data.
//   - K8s API responses are never stored or logged beyond metadata counts.
//   - Every call is audit-logged with cluster_id, namespace, resource type, count.
//
// Binding:
//   Items must have a row in item_k8s_bindings (created via BindK8s endpoint)
//   mapping them to a cluster_id + namespace_name. This binding is plaintext
//   because it is non-secret operational metadata the server needs to act on
//   (item field_values are client-side E2E encrypted and unreadable by the server).

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/auth"
	"envanter.app/server/internal/k8s"
)

// K8sHandlers groups per-item live K8s proxy endpoints.
type K8sHandlers struct {
	Service *auth.Service
	Audit   *audit.Writer
	Logger  *slog.Logger
}

// k8sBindRequest is the body for POST /api/v1/items/{id}/k8s/bind.
type k8sBindRequest struct {
	ClusterID     string `json:"cluster_id"`
	NamespaceName string `json:"namespace_name"`
}

// k8sBindingResponse is returned by GET /api/v1/items/{id}/k8s/binding.
type k8sBindingResponse struct {
	ItemID        string `json:"item_id"`
	ClusterID     string `json:"cluster_id"`
	NamespaceName string `json:"namespace_name"`
}

// ─── Binding CRUD ─────────────────────────────────────────────────────────────

// SetBinding implements POST /api/v1/items/{id}/k8s/bind.
// Requires item write permission or admin.
func (h *K8sHandlers) SetBinding(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", errors.New("no claims"))
		return
	}

	// Write permission required to set binding.
	if !hasRole(claims, RoleAdmin) {
		ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Yetki sorgulanamadı.", err)
			return
		}
		if !ip.AllowsWrite() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized, "Bu item için yazma yetkisi gerekli.", errors.New("write denied"))
			return
		}
	}

	var req k8sBindRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}
	if req.ClusterID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "cluster_id zorunlu.", errors.New("missing cluster_id"))
		return
	}
	if req.NamespaceName == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "namespace_name zorunlu.", errors.New("missing namespace_name"))
		return
	}

	_, err := h.Service.DB.Exec(ctx, `
		INSERT INTO item_k8s_bindings (item_id, cluster_id, namespace_name)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (item_id) DO UPDATE
		    SET cluster_id=$2::uuid, namespace_name=$3, updated_at=NOW()
	`, itemID, req.ClusterID, req.NamespaceName)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "K8s bağlaması kaydedilemedi.", err)
		return
	}
	writeJSON(w, http.StatusOK, k8sBindingResponse{
		ItemID:        itemID,
		ClusterID:     req.ClusterID,
		NamespaceName: req.NamespaceName,
	})
}

// GetBinding implements GET /api/v1/items/{id}/k8s/binding.
// Read permission sufficient.
func (h *K8sHandlers) GetBinding(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "id")
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", errors.New("no claims"))
		return
	}

	if !hasRole(claims, RoleAdmin) {
		ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
		if err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Yetki sorgulanamadı.", err)
			return
		}
		if !ip.AllowsRead() {
			writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized, "Bu item için okuma yetkisi gerekli.", errors.New("read denied"))
			return
		}
	}

	var resp k8sBindingResponse
	err := h.Service.DB.QueryRow(ctx, `
		SELECT item_id::text, cluster_id::text, namespace_name
		FROM item_k8s_bindings WHERE item_id=$1::uuid
	`, itemID).Scan(&resp.ItemID, &resp.ClusterID, &resp.NamespaceName)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "K8s bağlaması bulunamadı.", err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─── Live resource proxies ────────────────────────────────────────────────────

// resolveK8sClient looks up the item_k8s_bindings row, checks cluster is enabled,
// decrypts credentials, and returns a ready-to-use k8s.Client and namespace name.
func (h *K8sHandlers) resolveK8sClient(r *http.Request, itemID string) (*k8s.Client, string, error) {
	ctx := r.Context()

	var clusterID, namespaceName string
	err := h.Service.DB.QueryRow(ctx, `
		SELECT cluster_id::text, namespace_name
		FROM item_k8s_bindings
		WHERE item_id=$1::uuid
	`, itemID).Scan(&clusterID, &namespaceName)
	if err != nil {
		return nil, "", errors.New("k8s bağlaması bulunamadı — önce /k8s/bind ile kaydedin")
	}

	cfg, err := decryptClusterConfig(ctx, h.Service, clusterID)
	if err != nil {
		return nil, "", err
	}

	client, err := k8s.New(*cfg)
	if err != nil {
		return nil, "", err
	}
	return client, namespaceName, nil
}

// requireItemReadPerm checks read permission for itemID, unless caller is admin.
func (h *K8sHandlers) requireItemReadPerm(w http.ResponseWriter, r *http.Request, itemID string) bool {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", errors.New("no claims"))
		return false
	}
	if hasRole(claims, RoleAdmin) {
		return true
	}
	ip, err := auth.ResolveItemPermission(ctx, h.Service.DB, claims.Subject, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal, "Yetki sorgulanamadı.", err)
		return false
	}
	if !ip.AllowsRead() {
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeUnauthorized, "Bu item için okuma yetkisi gerekli.", errors.New("read denied"))
		return false
	}
	return true
}

func (h *K8sHandlers) writeK8sError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, k8s.ErrNotFound):
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "K8s kaynağı bulunamadı.", err)
	case errors.Is(err, k8s.ErrForbidden):
		writeError(w, h.Logger, http.StatusForbidden, ErrCodeForbidden, "K8s: yetersiz RBAC izni.", err)
	case errors.Is(err, k8s.ErrMetricsUnavailable):
		writeError(w, h.Logger, http.StatusServiceUnavailable, ErrCodeInternal, "metrics-server bu cluster'da kurulu değil.", err)
	default:
		writeError(w, h.Logger, http.StatusBadGateway, ErrCodeInternal, "K8s API isteği başarısız: "+err.Error(), err)
	}
}

// ListPods implements GET /api/v1/items/{id}/k8s/pods.
func (h *K8sHandlers) ListPods(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "id")
	if !h.requireItemReadPerm(w, r, itemID) {
		return
	}
	client, ns, err := h.resolveK8sClient(r, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest, err.Error(), err)
		return
	}
	result, err := client.ListPods(r.Context(), ns)
	if err != nil {
		h.writeK8sError(w, err)
		return
	}
	h.logK8sFetch(r, itemID, "pods", len(result.Items))
	writeJSON(w, http.StatusOK, result)
}

// ListDeployments implements GET /api/v1/items/{id}/k8s/deployments.
func (h *K8sHandlers) ListDeployments(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "id")
	if !h.requireItemReadPerm(w, r, itemID) {
		return
	}
	client, ns, err := h.resolveK8sClient(r, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest, err.Error(), err)
		return
	}
	result, err := client.ListDeployments(r.Context(), ns)
	if err != nil {
		h.writeK8sError(w, err)
		return
	}
	h.logK8sFetch(r, itemID, "deployments", len(result.Items))
	writeJSON(w, http.StatusOK, result)
}

// ListServices implements GET /api/v1/items/{id}/k8s/services.
func (h *K8sHandlers) ListServices(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "id")
	if !h.requireItemReadPerm(w, r, itemID) {
		return
	}
	client, ns, err := h.resolveK8sClient(r, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest, err.Error(), err)
		return
	}
	result, err := client.ListServices(r.Context(), ns)
	if err != nil {
		h.writeK8sError(w, err)
		return
	}
	h.logK8sFetch(r, itemID, "services", len(result.Items))
	writeJSON(w, http.StatusOK, result)
}

// ListEvents implements GET /api/v1/items/{id}/k8s/events.
func (h *K8sHandlers) ListEvents(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "id")
	if !h.requireItemReadPerm(w, r, itemID) {
		return
	}
	client, ns, err := h.resolveK8sClient(r, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest, err.Error(), err)
		return
	}
	result, err := client.ListEvents(r.Context(), ns)
	if err != nil {
		h.writeK8sError(w, err)
		return
	}
	h.logK8sFetch(r, itemID, "events", len(result.Items))
	writeJSON(w, http.StatusOK, result)
}

// ListMetrics implements GET /api/v1/items/{id}/k8s/metrics.
func (h *K8sHandlers) ListMetrics(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "id")
	if !h.requireItemReadPerm(w, r, itemID) {
		return
	}
	client, ns, err := h.resolveK8sClient(r, itemID)
	if err != nil {
		writeError(w, h.Logger, http.StatusUnprocessableEntity, ErrCodeBadRequest, err.Error(), err)
		return
	}
	result, err := client.ListPodMetrics(r.Context(), ns)
	if err != nil {
		h.writeK8sError(w, err)
		return
	}
	h.logK8sFetch(r, itemID, "metrics", len(result.Items))
	writeJSON(w, http.StatusOK, result)
}

// logK8sFetch writes an audit event for a K8s resource fetch.
// Payload is NEVER included — only metadata.
func (h *K8sHandlers) logK8sFetch(r *http.Request, itemID, resource string, count int) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		return
	}
	h.Audit.Write(ctx, audit.Entry{
		ActorUserID: claims.Subject,
		Action:      audit.ActionItemK8sFetch,
		Details: map[string]any{
			"item_id":  itemID,
			"resource": resource,
			"count":    count,
		},
	})
}
