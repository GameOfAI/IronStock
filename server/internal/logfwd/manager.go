package logfwd

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"

	"envanter.app/server/internal/audit"
)

const chanBuffer = 256

// Manager holds a set of active Forwarders and fans out audit events to all of them.
// It is safe for concurrent use.
type Manager struct {
	mu         sync.RWMutex
	forwarders map[string]Forwarder // keyed by config ID
	chans      map[string]chan Event
	cancels    map[string]context.CancelFunc
	logger     *slog.Logger
}

// NewManager creates an idle Manager with no forwarders.
func NewManager(logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	return &Manager{
		forwarders: make(map[string]Forwarder),
		chans:      make(map[string]chan Event),
		cancels:    make(map[string]context.CancelFunc),
		logger:     logger,
	}
}

// Publish implements audit.Publisher. It converts an audit.PublishEvent to a
// logfwd.Event and fans it out to all registered forwarders (non-blocking).
// Events are dropped when a forwarder's channel is full to avoid back-pressure
// on the audit write path.
func (m *Manager) Publish(aev audit.PublishEvent) {
	ev := Event{
		ID:           aev.ID,
		Action:       aev.Action,
		ActorUserID:  aev.ActorUserID,
		ResourceType: aev.ResourceType,
		ResourceID:   aev.ResourceID,
		Details:      json.RawMessage(aev.Details),
		CreatedAt:    aev.CreatedAt,
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for id, ch := range m.chans {
		select {
		case ch <- ev:
		default:
			m.logger.Warn("logfwd: channel full, dropping event",
				"config_id", id, "action", ev.Action)
		}
	}
}

// Add registers a new forwarder. If one with the same configID already exists
// it is replaced (Stop + Start).
func (m *Manager) Add(f Forwarder) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked(f.ConfigID())

	ch := make(chan Event, chanBuffer)
	ctx, cancel := context.WithCancel(context.Background())
	m.forwarders[f.ConfigID()] = f
	m.chans[f.ConfigID()] = ch
	m.cancels[f.ConfigID()] = cancel

	go m.runForwarder(ctx, f, ch)
}

// Remove stops and removes the forwarder for the given config ID.
func (m *Manager) Remove(configID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked(configID)
}

// StopAll shuts down all forwarders. Called on server shutdown.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id := range m.forwarders {
		m.stopLocked(id)
	}
}

// stopLocked must be called with m.mu held (write lock).
func (m *Manager) stopLocked(configID string) {
	if cancel, ok := m.cancels[configID]; ok {
		cancel()
		delete(m.cancels, configID)
	}
	if ch, ok := m.chans[configID]; ok {
		close(ch)
		delete(m.chans, configID)
	}
	if f, ok := m.forwarders[configID]; ok {
		if err := f.Close(); err != nil {
			m.logger.Warn("logfwd: error closing forwarder", "config_id", configID, "err", err)
		}
		delete(m.forwarders, configID)
	}
}

// runForwarder drains ch and calls f.Send for each event until ctx is done.
func (m *Manager) runForwarder(ctx context.Context, f Forwarder, ch <-chan Event) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			if err := f.Send(ctx, ev); err != nil {
				m.logger.Warn("logfwd: forward error",
					"config_id", f.ConfigID(), "action", ev.Action, "err", err)
			}
		}
	}
}

// BuildForwarder constructs a Forwarder from DB-persisted fields.
// targetType must be "syslog" or "slack". configJSON is the JSONB column.
func BuildForwarder(configID, targetType string, configJSON []byte) (Forwarder, error) {
	raw := json.RawMessage(configJSON)
	switch targetType {
	case "syslog":
		cfg, err := ParseSyslogConfig(raw)
		if err != nil {
			return nil, err
		}
		return NewSyslogForwarder(configID, cfg)
	case "slack":
		cfg, err := ParseSlackConfig(raw)
		if err != nil {
			return nil, err
		}
		return NewSlackForwarder(configID, cfg), nil
	default:
		return nil, nil
	}
}
