// Package audit writes audit log entries to the audit_log table.
//
// Audit entries are server-side plaintext for compliance and incident response
// (ADR-0002 §1). Callers MUST never put secret material in the details field;
// reference secrets only by metadata keys (e.g., {"field":"password"} not
// {"value":"hunter2"}).
package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Action constants — keep these dot-namespaced and exhaustive for grep-ability.
const (
	ActionAuthRegister     = "auth.register"
	ActionAuthTOTPInit     = "auth.totp_init"
	ActionAuthTOTPVerified = "auth.totp_verified"
	ActionAuthLogin        = "auth.login"
	ActionAuthLoginFail    = "auth.login_fail"
	ActionAuthLogout       = "auth.logout"
	ActionAuthLogoutAll    = "auth.logout_all"
	ActionAuthRefresh      = "auth.refresh"
	ActionAuthRefreshReuse = "auth.refresh_reuse_detected"
	ActionAuthPwdChanged   = "auth.password_changed"
	ActionAuthRecover      = "auth.recover"
	ActionAuthRecoverFail  = "auth.recover_fail"

	// ActionAuthSessionBindingChanged is emitted on /refresh when the
	// User-Agent or IP differs from the row stored at session creation.
	// Informational only — we do not block the refresh.
	ActionAuthSessionBindingChanged = "auth.session_binding_changed"

	// Folder lifecycle (PR-8).
	ActionFolderCreated          = "folder.created"
	ActionFolderUpdated          = "folder.updated"
	ActionFolderDeleted          = "folder.deleted"
	ActionFolderPermissionGrant  = "folder.permission_granted"
	ActionFolderPermissionRevoke = "folder.permission_revoked"

	// Item lifecycle (PR-9).
	ActionItemCreated      = "item.created"
	ActionItemUpdated      = "item.updated"
	ActionItemDeleted      = "item.deleted"
	ActionItemFieldUpdated = "item.field_updated"
	ActionItemShared       = "item.shared"
	ActionItemUnshared     = "item.unshared"

	// Read-event audit (PR-N6). Written async so hot-path latency is unaffected.
	// Vault/CyberArk model: every read is traceable in the audit log.
	ActionItemViewed   = "item.viewed"   // GET /items/{id} — full item + encrypted fields
	ActionItemListed   = "item.listed"   // GET /items?folder_id=... — item list in folder
	ActionFolderListed = "folder.listed" // GET /folders?parent_id=... — tree navigation

	// Admin actions (PR-10).
	ActionAdminUserDisabled = "admin.user_disabled"
	ActionAdminUserEnabled  = "admin.user_enabled"
	ActionAdminRoleGranted  = "admin.role_granted"
	ActionAdminRoleRevoked  = "admin.role_revoked"

	// ActionAuthBootstrapLogin is emitted when an admin logs in via the
	// TOTP-free bootstrap panel (ADR-0010). Requires ENVANTER_BOOTSTRAP_ENABLED=true.
	ActionAuthBootstrapSetup = "auth.bootstrap_setup"
	ActionAuthBootstrapLogin = "auth.bootstrap_login"

	// TOTP management (PR-F2a).
	ActionAuthTOTPDisabled          = "auth.totp_disabled"
	ActionAuthTOTPBackupRegenerated = "auth.totp_backup_regenerated"

	// Admin TOTP reset (PR-F2a).
	ActionAdminTOTPReset = "admin.totp_reset"
	// Admin per-user TOTP enforcement toggle (PR-SEC1).
	ActionAdminTOTPRequirementChanged = "admin.totp_requirement_changed"
	// Admin metadata export (PR-Export).
	ActionAdminExport = "admin.export"

	// Group lifecycle (PR-F6a).
	ActionGroupCreated       = "group.created"
	ActionGroupDeleted       = "group.deleted"
	ActionGroupMemberAdded   = "group.member_added"
	ActionGroupMemberRemoved = "group.member_removed"

	// Tags + favorites (PR-N7).
	ActionTagCreated      = "tag.created"
	ActionTagDeleted      = "tag.deleted"
	ActionItemTagged      = "item.tagged"
	ActionItemUntagged    = "item.untagged"
	ActionItemFavorited   = "item.favorited"
	ActionItemUnfavorited = "item.unfavorited"

	// Break-glass emergency access (PR-N4).
	// Emitted on every successful login by a break-glass account.
	// All admins receive an in-app notification + WS alert banner.
	ActionAuthBreakGlass = "auth.break_glass"

	// Graph/pipeline relationships (PR-F5a).
	ActionItemRelationshipAdded   = "item.relationship_added"
	ActionItemRelationshipRemoved = "item.relationship_removed"

	// Credential rotation/expiry (PR-N1).
	// ActionItemRotationRecorded is emitted when a user records that they
	// have rotated a credential (last_rotated_at set to now()).
	ActionItemRotationRecorded = "item.rotation_recorded"
	// ActionItemExpiryWarning is emitted by the background expiry scanner
	// when an item's expires_at is within the warning window.
	ActionItemExpiryWarning = "item.expiry_warning"

	// Trusted device (PR-F2b) — "remember this device for 30 days".
	ActionTrustedDeviceCreated = "auth.trusted_device_created"
	ActionTrustedDeviceRevoked = "auth.trusted_device_revoked"
	ActionTrustedDeviceUsed    = "auth.trusted_device_used" // TOTP skipped via cookie

	// One-time share links (PR-N5).
	ActionShareLinkCreated = "item.share_link_created"
	ActionShareLinkViewed  = "item.share_link_viewed"  // public endpoint hit + view_count++
	ActionShareLinkExpired = "item.share_link_expired" // view_limit or TTL reached
	ActionShareLinkRevoked = "item.share_link_revoked"

	// Client certificate management (PR-SEC3).
	// ActionAdminClientCertIssued: admin issues a leaf cert from the built-in CA.
	ActionAdminClientCertIssued = "admin.client_cert_issued"
	// ActionAdminClientCertRegistered: admin registers an external cert PEM.
	ActionAdminClientCertRegistered = "admin.client_cert_registered"
	// ActionAdminClientCertRevoked: admin revokes a cert (sets revoked_at).
	ActionAdminClientCertRevoked = "admin.client_cert_revoked"
	// ActionAdminClientCertCARegistered: admin uploads an external CA.
	ActionAdminClientCertCARegistered = "admin.client_cert_ca_registered"
	// ActionAdminClientCertCADeleted: admin deletes a non-builtin CA.
	ActionAdminClientCertCADeleted = "admin.client_cert_ca_deleted"
	// ActionAdminClientCertRequirementChanged: admin toggles requires_client_cert.
	ActionAdminClientCertRequirementChanged = "admin.client_cert_requirement_changed"
	// ActionAuthClientCertRejected: login rejected because client cert validation failed.
	ActionAuthClientCertRejected = "auth.client_cert_rejected"
	// ActionAuthKeypairInitialized: placeholder keypair replaced with proper one on first client login.
	ActionAuthKeypairInitialized = "auth.keypair_initialized"

	// Log forwarding management (PR-LOG1).
	ActionAdminLogForwardingCreated = "admin.log_forwarding_created"
	ActionAdminLogForwardingUpdated = "admin.log_forwarding_updated"
	ActionAdminLogForwardingDeleted = "admin.log_forwarding_deleted"
	ActionAdminLogForwardingTested  = "admin.log_forwarding_tested"
)

// ResourceGroup is the audit resource type for group rows.
const ResourceGroup = "group"

// ResourceFolder is the audit resource type for folder rows.
const ResourceFolder = "folder"

// Resource type constants.
const (
	ResourceUser    = "user"
	ResourceSession = "session"
	ResourceItem    = "item"
)

// Entry is one audit_log row.
type Entry struct {
	// ActorUserID is the acting user's UUID, or empty for system actions.
	ActorUserID string
	Action      string
	// ResourceType + ResourceID identify the affected row, both optional.
	ResourceType string
	ResourceID   string
	// Details is action-specific structured context. MUST NOT contain secrets.
	Details map[string]any
	// IPAddress is the originating client IP (post X-Forwarded-For trust).
	IPAddress netip.Addr
	UserAgent string
}

// Publisher receives audit events for forwarding (logfwd.Manager implements this).
type Publisher interface {
	Publish(ev PublishEvent)
}

// PublishEvent is the forwarder-facing view of an audit entry.
type PublishEvent struct {
	ID           string
	Action       string
	ActorUserID  *string
	ResourceType *string
	ResourceID   *string
	Details      json.RawMessage
	CreatedAt    time.Time
}

// Writer persists audit entries.
type Writer struct {
	db        *pgxpool.Pool
	publisher Publisher // optional — set via SetPublisher
}

// NewWriter wraps a connection pool.
func NewWriter(db *pgxpool.Pool) *Writer {
	return &Writer{db: db}
}

// SetPublisher registers a forwarder manager that receives every committed entry.
// Safe to call before the server starts accepting requests.
func (w *Writer) SetPublisher(p Publisher) {
	w.publisher = p
}

// Write inserts an Entry. Best-effort: callers should log but not abort the
// request if audit writing fails (the user-visible action still succeeded).
func (w *Writer) Write(ctx context.Context, e Entry) error {
	if e.Action == "" {
		return errors.New("audit: action is required")
	}
	detailsJSON, err := json.Marshal(e.Details)
	if err != nil {
		return fmt.Errorf("audit: marshal details: %w", err)
	}
	if len(e.Details) == 0 {
		detailsJSON = []byte(`{}`)
	}

	const insertSQL = `
		INSERT INTO audit_log (
			actor_user_id, action, resource_type, resource_id,
			details, ip_address, user_agent
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	args := []any{
		nullUUID(e.ActorUserID),
		e.Action,
		nullString(e.ResourceType),
		nullUUID(e.ResourceID),
		detailsJSON,
		nullAddr(e.IPAddress),
		nullString(e.UserAgent),
	}
	var insertedID string
	var createdAt time.Time
	const insertWithIDSQL = `
		INSERT INTO audit_log (
			actor_user_id, action, resource_type, resource_id,
			details, ip_address, user_agent
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id::text, created_at
	`
	if err := w.db.QueryRow(ctx, insertWithIDSQL, args...).Scan(&insertedID, &createdAt); err != nil {
		// Fallback: try insert without RETURNING (shouldn't happen but safe).
		if _, err2 := w.db.Exec(ctx, insertSQL, args...); err2 != nil {
			return fmt.Errorf("audit: insert: %w", err2)
		}
	}

	// Fan out to forwarders (non-blocking, fire-and-forget).
	if w.publisher != nil && insertedID != "" {
		var actorPtr *string
		if e.ActorUserID != "" {
			s := e.ActorUserID
			actorPtr = &s
		}
		var resTypePtr *string
		if e.ResourceType != "" {
			s := e.ResourceType
			resTypePtr = &s
		}
		var resIDPtr *string
		if e.ResourceID != "" {
			s := e.ResourceID
			resIDPtr = &s
		}
		w.publisher.Publish(PublishEvent{
			ID:           insertedID,
			Action:       e.Action,
			ActorUserID:  actorPtr,
			ResourceType: resTypePtr,
			ResourceID:   resIDPtr,
			Details:      detailsJSON,
			CreatedAt:    createdAt,
		})
	}
	return nil
}

// WriteAsync fires Write in a background goroutine, isolated from the
// request context (uses context.Background()). Errors are silently dropped.
//
// Use on high-frequency read paths (item.viewed, item.listed, folder.listed)
// where adding a synchronous DB round-trip to each GET would measurably
// increase p99 latency. Mutation paths keep using Write() directly.
func (w *Writer) WriteAsync(e Entry) {
	go func() {
		_ = w.Write(context.Background(), e)
	}()
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullAddr(a netip.Addr) any {
	if !a.IsValid() {
		return nil
	}
	return a.String()
}
