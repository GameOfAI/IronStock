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
