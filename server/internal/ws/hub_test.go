package ws

import (
	"io"
	"log/slog"
	"testing"
	"time"
)

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestNewEvent_FieldsPopulated(t *testing.T) {
	before := time.Now().UTC()
	ev := NewEvent(EventItemCreated, "item-1", "user-2")
	after := time.Now().UTC()

	if ev.Type != EventItemCreated {
		t.Errorf("Type = %q, want %q", ev.Type, EventItemCreated)
	}
	if ev.ResourceID != "item-1" {
		t.Errorf("ResourceID = %q, want item-1", ev.ResourceID)
	}
	if ev.ActorUserID != "user-2" {
		t.Errorf("ActorUserID = %q, want user-2", ev.ActorUserID)
	}
	if ev.Timestamp.Before(before) || ev.Timestamp.After(after.Add(time.Second)) {
		t.Errorf("Timestamp out of bounds: %v not in [%v, %v]", ev.Timestamp, before, after)
	}
}

func TestHub_NewHub_StatsZero(t *testing.T) {
	h := NewHub(quietLogger())
	defer h.Close()
	if got := h.Stats(); got != 0 {
		t.Errorf("Stats() = %d, want 0", got)
	}
}

func TestHub_PublishWithNoConns_NoOp(t *testing.T) {
	h := NewHub(quietLogger())
	defer h.Close()

	// Should not block, panic, or do anything observable.
	h.Publish(NewEvent(EventItemCreated, "id", "actor"))

	if got := h.Stats(); got != 0 {
		t.Errorf("Stats after publish = %d, want 0", got)
	}
}

func TestHub_Close_Idempotent(_ *testing.T) {
	h := NewHub(quietLogger())
	h.Close()
	// Second close must not panic.
	h.Close()
}

func TestEventConstants(t *testing.T) {
	// Pin the wire format strings — clients use these literally.
	cases := map[string]string{
		EventFolderCreated:    "folder.created",
		EventFolderUpdated:    "folder.updated",
		EventFolderDeleted:    "folder.deleted",
		EventItemCreated:      "item.created",
		EventItemUpdated:      "item.updated",
		EventItemDeleted:      "item.deleted",
		EventItemShared:       "item.shared",
		EventItemUnshared:     "item.unshared",
		EventItemFieldUpdated: "item.field_updated",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("event constant drift: got %q, want %q", got, want)
		}
	}
}
