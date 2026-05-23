package ws_test

import (
	"testing"

	"envanter.app/server/internal/ws"
)

func TestTicketStore_IssueConsume(t *testing.T) {
	ts := ws.NewTicketStore()

	token, err := ts.Issue("user-123")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if len(token) != 64 {
		t.Errorf("expected 64-char hex token, got %d chars", len(token))
	}

	userID, ok := ts.Consume(token)
	if !ok {
		t.Fatal("Consume: ticket not found")
	}
	if userID != "user-123" {
		t.Errorf("expected userID %q, got %q", "user-123", userID)
	}

	// Second consume must fail (one-time use)
	_, ok = ts.Consume(token)
	if ok {
		t.Error("expected second Consume to fail; ticket should be single-use")
	}
}

func TestTicketStore_UnknownToken(t *testing.T) {
	ts := ws.NewTicketStore()
	_, ok := ts.Consume("nonexistent")
	if ok {
		t.Error("expected Consume of nonexistent token to return false")
	}
}

func TestTicketStore_Cleanup(t *testing.T) {
	ts := ws.NewTicketStore()
	// Issue and then cleanup; the ticket should still be there (not yet expired).
	token, err := ts.Issue("user-456")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	ts.Cleanup() // should not remove valid tickets
	_, ok := ts.Consume(token)
	if !ok {
		t.Error("Cleanup removed a valid (non-expired) ticket")
	}
}
