package ws

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

const (
	ticketTTL  = 30 * time.Second
	ticketSize = 32 // bytes → 64 hex chars
)

type ticketEntry struct {
	userID    string
	expiresAt time.Time
}

// TicketStore issues and consumes one-time WS upgrade tickets.
//
// Motivation: the browser WebSocket API cannot set the Authorization header,
// so the naive fallback is to put the access token in the URL query string
// (?access_token=...). That token then appears in proxy logs, CDN access logs,
// and browser history — a meaningful credential-exposure risk.
//
// Instead the client performs a short authenticated REST call
// (POST /api/v1/ws/ticket) with a normal Bearer header, receives a
// random 32-byte ticket valid for 30 seconds, and uses that in the WS URL
// (?ticket=...). The ticket is consumed on first use and carries no long-term
// credential value if it leaks.
//
// TicketStore is safe for concurrent use. A background goroutine prunes
// expired entries lazily when Cleanup is called, but callers that want
// guaranteed pruning should schedule periodic Cleanup calls. In practice
// the store stays small (one entry per authenticated session connecting to WS).
type TicketStore struct {
	mu      sync.Mutex
	tickets map[string]ticketEntry
}

// NewTicketStore returns an initialized, ready-to-use TicketStore.
func NewTicketStore() *TicketStore {
	return &TicketStore{
		tickets: make(map[string]ticketEntry),
	}
}

// Issue generates a cryptographically random ticket for userID and stores it
// with a 30-second TTL. Returns the hex-encoded ticket string.
func (ts *TicketStore) Issue(userID string) (string, error) {
	b := make([]byte, ticketSize)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)

	ts.mu.Lock()
	ts.tickets[token] = ticketEntry{
		userID:    userID,
		expiresAt: time.Now().Add(ticketTTL),
	}
	ts.mu.Unlock()

	return token, nil
}

// Consume validates and deletes the ticket in a single atomic operation.
// Returns the userID on success, or an empty string + false if the ticket
// is unknown, expired, or already consumed.
func (ts *TicketStore) Consume(token string) (userID string, ok bool) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	entry, exists := ts.tickets[token]
	if !exists {
		return "", false
	}
	// Always delete — expired tickets must not be reusable either.
	delete(ts.tickets, token)

	if time.Now().After(entry.expiresAt) {
		return "", false
	}
	return entry.userID, true
}

// Cleanup removes all expired tickets. Call periodically (e.g. once per
// minute) to prevent unbounded map growth under load. Safe for concurrent use.
func (ts *TicketStore) Cleanup() {
	now := time.Now()
	ts.mu.Lock()
	for tok, e := range ts.tickets {
		if now.After(e.expiresAt) {
			delete(ts.tickets, tok)
		}
	}
	ts.mu.Unlock()
}
