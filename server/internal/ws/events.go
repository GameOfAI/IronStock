package ws

import "time"

// Event types — keep dot-namespaced and exhaustive for grep-ability.
const (
	EventFolderCreated = "folder.created"
	EventFolderUpdated = "folder.updated"
	EventFolderDeleted = "folder.deleted"

	EventItemCreated      = "item.created"
	EventItemUpdated      = "item.updated"
	EventItemDeleted      = "item.deleted"
	EventItemShared       = "item.shared"
	EventItemUnshared     = "item.unshared"
	EventItemFieldUpdated = "item.field_updated"

	// EventItemExpiryWarning is published by the background expiry scanner
	// (PR-N1) when an item's expires_at is within the warning window (7 days).
	// Clients invalidate the item cache so the expiry badge renders.
	EventItemExpiryWarning = "item.expiry_warning"

	// EventNotificationCreated is published when a new notification row is
	// inserted for a user (PR-N8). resource_id = notification UUID.
	EventNotificationCreated = "notification.created"

	// EventBreakGlassLogin is published when a break-glass account logs in
	// (PR-N4). All connected admin clients show an immediate alert banner.
	// resource_id = the break-glass user's UUID.
	EventBreakGlassLogin = "auth.break_glass"
)

// Event is the JSON payload sent over the wire.
//
// Deliberately minimal: just enough for clients to invalidate their cache
// and re-fetch via REST. No metadata, no field values — those go through
// RBAC-checked endpoints on read.
//
// Wire format (JSON):
//
//	{"type":"item.updated","resource_id":"<uuid>",
//	 "actor_user_id":"<uuid>","timestamp":"2026-04-27T10:30:00Z"}
type Event struct {
	Type        string    `json:"type"`
	ResourceID  string    `json:"resource_id"`
	ActorUserID string    `json:"actor_user_id,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// NewEvent stamps the current time and returns the event ready to publish.
func NewEvent(eventType, resourceID, actorUserID string) Event {
	return Event{
		Type:        eventType,
		ResourceID:  resourceID,
		ActorUserID: actorUserID,
		Timestamp:   time.Now().UTC(),
	}
}
