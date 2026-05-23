package httpapi

// notification_channel_handlers.go — PR-NOTIFY
//
// Per-user notification prefs (type × channel matrix) ve
// external webhook kanal yönetimi (Slack / Teams).
//
// Endpointler:
//   GET    /api/v1/users/me/notification-prefs
//   PUT    /api/v1/users/me/notification-prefs
//   GET    /api/v1/users/me/channels
//   POST   /api/v1/users/me/channels
//   DELETE /api/v1/users/me/channels/{channel_id}
//   POST   /api/v1/users/me/channels/{channel_id}/test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"envanter.app/server/internal/audit"
	"envanter.app/server/internal/crypto"
)

// ---------------------------------------------------------------------------
// Notification Prefs
// ---------------------------------------------------------------------------

type notificationPref struct {
	NotificationType string   `json:"notification_type"`
	Channels         []string `json:"channels"`
}

type notificationPrefsResponse struct {
	Prefs []notificationPref `json:"prefs"`
}

type updateNotificationPrefsRequest struct {
	Prefs []notificationPref `json:"prefs"`
}

// GetNotificationPrefs — GET /api/v1/users/me/notification-prefs
func (h *NotificationHandlers) GetNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}

	const sqlText = `
		SELECT notification_type, channels
		FROM user_notification_prefs
		WHERE user_id = $1::uuid
		ORDER BY notification_type
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Tercihler yüklenemedi.", err)
		return
	}
	defer rows.Close()

	prefs := make([]notificationPref, 0)
	for rows.Next() {
		var p notificationPref
		if err := rows.Scan(&p.NotificationType, &p.Channels); err != nil {
			continue
		}
		prefs = append(prefs, p)
	}

	writeJSON(w, http.StatusOK, notificationPrefsResponse{Prefs: prefs})
}

// UpdateNotificationPrefs — PUT /api/v1/users/me/notification-prefs
func (h *NotificationHandlers) UpdateNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	var req updateNotificationPrefsRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}

	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}

	validTypes := map[string]bool{
		"access_request": true, "share_added": true, "credential_expiring": true,
		"security_alert": true, "mention": true, "system_announcement": true, "break_glass_alert": true,
	}
	validChannels := map[string]bool{
		"inapp": true, "email": true, "slack": true, "teams": true,
	}

	for _, p := range req.Prefs {
		if !validTypes[p.NotificationType] {
			writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
				fmt.Sprintf("Geçersiz notification_type: %s", p.NotificationType), nil)
			return
		}
		for _, ch := range p.Channels {
			if !validChannels[ch] {
				writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
					fmt.Sprintf("Geçersiz kanal: %s", ch), nil)
				return
			}
		}
	}

	const upsertSQL = `
		INSERT INTO user_notification_prefs (user_id, notification_type, channels, updated_at)
		VALUES ($1::uuid, $2, $3, now())
		ON CONFLICT (user_id, notification_type) DO UPDATE SET
			channels   = EXCLUDED.channels,
			updated_at = now()
	`
	for _, p := range req.Prefs {
		if _, err := h.Service.DB.Exec(ctx, upsertSQL, claims.Subject, p.NotificationType, p.Channels); err != nil {
			writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
				"Tercihler kaydedilemedi.", err)
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Tercihler güncellendi."})
}

// ---------------------------------------------------------------------------
// External Channels (Slack / Teams Webhooks)
// ---------------------------------------------------------------------------

type addExternalChannelRequest struct {
	ChannelType string `json:"channel_type"` // "slack" | "teams"
	WebhookURL  string `json:"webhook_url"`
	ChannelName string `json:"channel_name"`
}

type externalChannelResponse struct {
	ID          string  `json:"id"`
	ChannelType string  `json:"channel_type"`
	ChannelName string  `json:"channel_name"`
	Enabled     bool    `json:"enabled"`
	LastUsedAt  *string `json:"last_used_at,omitempty"`
	LastError   *string `json:"last_error,omitempty"`
	CreatedAt   string  `json:"created_at"`
}

// ListExternalChannels — GET /api/v1/users/me/channels
func (h *NotificationHandlers) ListExternalChannels(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}

	const sqlText = `
		SELECT id::text, channel_type, channel_name, enabled,
		       to_char(last_used_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), last_error,
		       created_at
		FROM user_external_channels
		WHERE user_id = $1::uuid
		ORDER BY created_at DESC
	`
	rows, err := h.Service.DB.Query(ctx, sqlText, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kanallar yüklenemedi.", err)
		return
	}
	defer rows.Close()

	channels := make([]externalChannelResponse, 0)
	for rows.Next() {
		var ch externalChannelResponse
		var createdAt time.Time
		if err := rows.Scan(
			&ch.ID, &ch.ChannelType, &ch.ChannelName, &ch.Enabled,
			&ch.LastUsedAt, &ch.LastError, &createdAt,
		); err != nil {
			continue
		}
		ch.CreatedAt = createdAt.Format(time.RFC3339)
		channels = append(channels, ch)
	}

	writeJSON(w, http.StatusOK, map[string]any{"channels": channels})
}

// AddExternalChannel — POST /api/v1/users/me/channels
// Webhook URL'yi şifreleyip kaydeder. Önce test mesajı gönderir.
func (h *NotificationHandlers) AddExternalChannel(w http.ResponseWriter, r *http.Request) {
	var req addExternalChannelRequest
	if !decodeJSON(w, r, h.Logger, &req) {
		return
	}

	if err := validateExternalChannelRequest(req); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, err.Error(), err)
		return
	}

	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}

	// Test mesajı gönder — başarısız ise kaydetme
	if err := sendTestWebhook(ctx, req.ChannelType, req.WebhookURL, req.ChannelName); err != nil {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			fmt.Sprintf("Webhook test başarısız: %s", err.Error()), err)
		return
	}

	// UUID önceden üret — AAD'de channel ID kullanmak için (cross-row attack prevention)
	channelUUID := uuid.New().String()

	// Webhook URL'yi şifrele — AAD = "user_external_channels" + channel_id + "webhook_url_enc"
	aad := crypto.MakeAAD("user_external_channels", channelUUID, "webhook_url_enc")
	encBlob, err := h.Service.Master.Seal([]byte(req.WebhookURL), aad)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Webhook URL şifrelenemedi.", err)
		return
	}

	const insertSQL = `
		INSERT INTO user_external_channels
			(id, user_id, channel_type, webhook_url_enc, channel_name, enabled)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, true)
		RETURNING id::text, created_at
	`
	var id string
	var createdAt time.Time
	err = h.Service.DB.QueryRow(ctx, insertSQL,
		channelUUID, claims.Subject, req.ChannelType, encBlob, req.ChannelName,
	).Scan(&id, &createdAt)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kanal kaydedilemedi.", err)
		return
	}

	if h.Audit != nil {
		_ = h.Audit.Write(ctx, audit.Entry{
			ActorUserID:  claims.Subject,
			Action:       "notification.channel_added",
			ResourceType: "notification_channel",
			ResourceID:   id,
			IPAddress:    parseIP(r.RemoteAddr),
		})
	}

	writeJSON(w, http.StatusCreated, externalChannelResponse{
		ID:          id,
		ChannelType: req.ChannelType,
		ChannelName: req.ChannelName,
		Enabled:     true,
		CreatedAt:   createdAt.Format(time.RFC3339),
	})
}

// DeleteExternalChannel — DELETE /api/v1/users/me/channels/{channel_id}
func (h *NotificationHandlers) DeleteExternalChannel(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}

	channelID := chi.URLParam(r, "channel_id")
	if channelID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "channel_id gerekli.", nil)
		return
	}

	const deleteSQL = `
		DELETE FROM user_external_channels
		WHERE id = $1::uuid AND user_id = $2::uuid
	`
	tag, err := h.Service.DB.Exec(ctx, deleteSQL, channelID, claims.Subject)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Kanal silinemedi.", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Kanal bulunamadı.", nil)
		return
	}

	if h.Audit != nil {
		_ = h.Audit.Write(ctx, audit.Entry{
			ActorUserID:  claims.Subject,
			Action:       "notification.channel_removed",
			ResourceType: "notification_channel",
			ResourceID:   channelID,
			IPAddress:    parseIP(r.RemoteAddr),
		})
	}

	w.WriteHeader(http.StatusNoContent)
}

// TestExternalChannel — POST /api/v1/users/me/channels/{channel_id}/test
func (h *NotificationHandlers) TestExternalChannel(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ClaimsFromContext(ctx)
	if claims == nil {
		writeError(w, h.Logger, http.StatusUnauthorized, ErrCodeUnauthorized, "Token gerekli.", nil)
		return
	}

	channelID := chi.URLParam(r, "channel_id")
	if channelID == "" {
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest, "channel_id gerekli.", nil)
		return
	}

	const sqlText = `
		SELECT channel_type, channel_name, webhook_url_enc
		FROM user_external_channels
		WHERE id = $1::uuid AND user_id = $2::uuid
	`
	var channelType, channelName string
	var encBlob []byte
	err := h.Service.DB.QueryRow(ctx, sqlText, channelID, claims.Subject).
		Scan(&channelType, &channelName, &encBlob)
	if err != nil {
		writeError(w, h.Logger, http.StatusNotFound, ErrCodeNotFound, "Kanal bulunamadı.", err)
		return
	}

	// Webhook URL'yi decrypt et — AAD channel ID ile oluşturuldu (AddExternalChannel ile tutarlı)
	aad := crypto.MakeAAD("user_external_channels", channelID, "webhook_url_enc")
	webhookURL, err := h.Service.Master.Open(encBlob, aad)
	if err != nil {
		writeError(w, h.Logger, http.StatusInternalServerError, ErrCodeInternal,
			"Webhook URL çözülemedi.", err)
		return
	}

	if err := sendTestWebhook(ctx, channelType, string(webhookURL), channelName); err != nil {
		_, _ = h.Service.DB.Exec(ctx,
			`UPDATE user_external_channels SET last_error = $2 WHERE id = $1::uuid`,
			channelID, err.Error(),
		)
		writeError(w, h.Logger, http.StatusBadRequest, ErrCodeBadRequest,
			fmt.Sprintf("Test mesajı gönderilemedi: %s", err.Error()), err)
		return
	}

	_, _ = h.Service.DB.Exec(ctx,
		`UPDATE user_external_channels SET last_used_at = now(), last_error = NULL WHERE id = $1::uuid`,
		channelID,
	)

	if h.Audit != nil {
		_ = h.Audit.Write(ctx, audit.Entry{
			ActorUserID:  claims.Subject,
			Action:       "notification.channel_test_sent",
			ResourceType: "notification_channel",
			ResourceID:   channelID,
			IPAddress:    parseIP(r.RemoteAddr),
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Test mesajı gönderildi."})
}

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------

func sendTestWebhook(ctx context.Context, channelType, webhookURL, channelName string) error {
	switch channelType {
	case "slack":
		return sendSlackMessage(ctx, webhookURL,
			fmt.Sprintf("🔔 *IronStock* test mesajı — *%s* kanalı başarıyla bağlandı!", channelName))
	case "teams":
		return sendTeamsMessage(ctx, webhookURL, "Bağlantı Testi",
			fmt.Sprintf("*%s* kanalı IronStock'a başarıyla bağlandı.", channelName))
	default:
		return fmt.Errorf("bilinmeyen kanal tipi: %s", channelType)
	}
}

// sendSlackMessage, Slack Incoming Webhook'a Block Kit mesajı gönderir.
func sendSlackMessage(ctx context.Context, webhookURL, text string) error {
	payload := map[string]any{
		"blocks": []map[string]any{
			{
				"type": "section",
				"text": map[string]string{"type": "mrkdwn", "text": text},
			},
		},
	}
	return postWebhookJSON(ctx, webhookURL, payload)
}

// sendTeamsMessage, Teams Incoming Webhook'a MessageCard gönderir.
func sendTeamsMessage(ctx context.Context, webhookURL, title, text string) error {
	payload := map[string]any{
		"@type":      "MessageCard",
		"@context":   "https://schema.org/extensions",
		"summary":    "IronStock — " + title,
		"themeColor": "6366f1",
		"title":      "IronStock — " + title,
		"text":       text,
	}
	return postWebhookJSON(ctx, webhookURL, payload)
}

func postWebhookJSON(ctx context.Context, url string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("json marshal: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("request oluşturulamadı: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("webhook isteği başarısız: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook HTTP %d döndü", resp.StatusCode)
	}
	return nil
}

func validateExternalChannelRequest(req addExternalChannelRequest) error {
	if req.ChannelType != "slack" && req.ChannelType != "teams" {
		return errors.New("channel_type 'slack' veya 'teams' olmalıdır")
	}
	if req.WebhookURL == "" {
		return errors.New("webhook_url gerekli")
	}
	if len(req.WebhookURL) > 2048 {
		return errors.New("webhook_url çok uzun (max 2048 karakter)")
	}
	if req.ChannelName == "" {
		return errors.New("channel_name gerekli")
	}
	return nil
}
