package ws

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"envanter.app/server/internal/cache"
)

// wsRedisChannel is the pub/sub channel name for cross-pod WS fan-out.
const wsRedisChannel = "ws:events"

// Hub is the central registry of active WebSocket connections.
//
// Lifecycle:
//   - Hub created once at startup (cmd/api/main.go) → NewHub or NewHubWithRedis
//   - HTTP /ws upgrade calls Accept then Register; Connection takes over the socket
//   - Handler emits events via Hub.Publish; fan-out is non-blocking
//   - On client disconnect or server shutdown, Connection.close() cleans up
//   - main.go calls Hub.Close() at graceful shutdown to drop all conns
//
// When redis is non-nil, Publish also sends the event to the shared Redis
// channel so other pod instances can fan-out to their local connections.
// Each pod subscribes on startup; self-echo is suppressed via podID.
//
// Hub uses its OWN long-lived context (not the request context) so chi's
// per-request Timeout middleware doesn't kill live connections.
//
// Hub is safe for concurrent use.
type Hub struct {
	logger *slog.Logger
	redis  *cache.Client // nil = single-pod mode
	podID  string        // unique per-process; suppresses self-echo

	// ctx + cancel: hub lifetime; per-conn goroutines anchor here.
	ctx    context.Context
	cancel context.CancelFunc

	mu          sync.RWMutex
	connections map[*Connection]struct{}

	// nextConnID is monotonic for log correlation only — not security.
	nextConnID atomic.Uint64
}

// NewHub returns a freshly initialized Hub in single-pod mode.
// Caller MUST call Close() at graceful shutdown to drain connections cleanly.
func NewHub(logger *slog.Logger) *Hub {
	return newHub(logger, nil, "")
}

// NewHubWithRedis returns a Hub that publishes events to Redis pub/sub for
// multi-replica fan-out. It also starts a background subscriber goroutine.
// podID must be unique per process (e.g. hostname + PID).
func NewHubWithRedis(logger *slog.Logger, redis *cache.Client, podID string) *Hub {
	h := newHub(logger, redis, podID)
	go h.subscribeLoop()
	return h
}

func newHub(logger *slog.Logger, redis *cache.Client, podID string) *Hub {
	ctx, cancel := context.WithCancel(context.Background())
	return &Hub{
		logger:      logger,
		redis:       redis,
		podID:       podID,
		ctx:         ctx,
		cancel:      cancel,
		connections: make(map[*Connection]struct{}),
	}
}

// Close cancels the hub context and tears down all live connections.
// Safe to call multiple times (idempotent via context cancel + per-conn
// closeOnce).
func (h *Hub) Close() {
	h.cancel()
	h.mu.Lock()
	conns := make([]*Connection, 0, len(h.connections))
	for c := range h.connections {
		conns = append(conns, c)
	}
	h.connections = make(map[*Connection]struct{})
	h.mu.Unlock()
	for _, c := range conns {
		_ = c.close()
	}
}

// Register adds a connection to the hub and returns a release function the
// caller must defer. The release closes the socket and removes it from
// the registry.
func (h *Hub) Register(c *Connection) func() {
	h.mu.Lock()
	h.connections[c] = struct{}{}
	count := len(h.connections)
	h.mu.Unlock()

	h.logger.Info("ws conn registered",
		slog.Uint64("conn_id", c.id),
		slog.String("user_id", c.userID),
		slog.Int("total_conns", count),
	)
	return func() {
		h.mu.Lock()
		delete(h.connections, c)
		count := len(h.connections)
		h.mu.Unlock()
		_ = c.close()
		h.logger.Info("ws conn deregistered",
			slog.Uint64("conn_id", c.id),
			slog.Int("total_conns", count),
		)
	}
}

// redisEnvelope wraps an event with the origin pod ID so subscribers can
// skip self-echoed messages.
type redisEnvelope struct {
	PodID string `json:"pod_id"`
	Event Event  `json:"event"`
}

// Publish fan-outs the event to every local connection, and — when Redis is
// configured — also publishes to the shared channel for other pods.
// Drops on per-conn channel overflow rather than blocking.
//
// Safe to call from any goroutine, including the request hot path.
func (h *Hub) Publish(ev Event) {
	h.localPublish(ev)

	if h.redis == nil || h.redis.IsOpen() {
		return
	}
	env := redisEnvelope{PodID: h.podID, Event: ev}
	data, err := json.Marshal(env)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := h.redis.Publish(ctx, wsRedisChannel, data); err != nil {
		h.logger.Warn("ws: redis publish failed; event only sent locally",
			slog.String("event_type", ev.Type),
			slog.String("error", err.Error()))
	}
}

// localPublish fan-outs ev to all connections registered in this pod.
func (h *Hub) localPublish(ev Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.connections {
		select {
		case c.send <- ev:
		default:
			h.logger.Warn("ws conn send buffer full; dropping event",
				slog.Uint64("conn_id", c.id),
				slog.String("user_id", c.userID),
				slog.String("event_type", ev.Type),
			)
		}
	}
}

// subscribeLoop runs in a background goroutine when Redis is configured.
// It subscribes to the shared WS channel and forwards events from other pods
// to the local connection pool.
func (h *Hub) subscribeLoop() {
	if h.redis == nil {
		return
	}
	h.logger.Info("ws: starting Redis pub/sub subscriber", slog.String("channel", wsRedisChannel))
	for {
		select {
		case <-h.ctx.Done():
			return
		default:
		}
		sub := h.redis.Subscribe(h.ctx, wsRedisChannel)
		ch := sub.Channel()
		for msg := range ch {
			var env redisEnvelope
			if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
				h.logger.Warn("ws: bad redis envelope", slog.String("error", err.Error()))
				continue
			}
			// Skip events we published ourselves.
			if env.PodID == h.podID {
				continue
			}
			h.localPublish(env.Event)
		}
		// ch closed → subscription ended (ctx cancelled or Redis error)
		_ = sub.Close()
		if h.ctx.Err() != nil {
			return
		}
		// Reconnect after backoff
		h.logger.Warn("ws: Redis subscription dropped; reconnecting in 5s")
		select {
		case <-h.ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

// Stats returns a snapshot of hub state for /readyz extensions or admin
// debug endpoints (Faz 4+). Safe for any caller.
func (h *Hub) Stats() (totalConns int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.connections)
}

// Accept upgrades wraps a freshly-upgraded websocket.Conn in a Connection
// struct. The reader + writer goroutines anchor on the hub's context, so
// they survive past the originating HTTP request. Caller MUST then call
// Register, defer the release, and wait on c.Closed().
func (h *Hub) Accept(conn *websocket.Conn, userID string) *Connection {
	c := &Connection{
		id:     h.nextConnID.Add(1),
		userID: userID,
		conn:   conn,
		send:   make(chan Event, sendBufferSize),
		closed: make(chan struct{}),
	}
	go c.runWriter(h.ctx, h.logger)
	go c.runReader(h.ctx, h.logger)
	return c
}

// --- Connection ---

const (
	// sendBufferSize is per-connection; ~10ms worth of events at 100/sec.
	sendBufferSize = 32

	// pingInterval keeps proxies / load-balancers from culling idle conns.
	pingInterval = 30 * time.Second

	// writeTimeout caps a single send. Slow clients are dropped.
	writeTimeout = 10 * time.Second
)

// Connection wraps a single client WebSocket. One per (user, device).
type Connection struct {
	id     uint64
	userID string

	conn *websocket.Conn
	send chan Event

	closeOnce sync.Once
	closed    chan struct{}
}

// Closed returns a channel that's closed when this connection ends
// (either client disconnect, server shutdown, or write error).
// Used by /ws HTTP handler to park its goroutine until the conn dies.
func (c *Connection) Closed() <-chan struct{} {
	return c.closed
}

// runWriter drains the send chan and writes to the socket. Also pumps
// periodic pings for keep-alive.
func (c *Connection) runWriter(ctx context.Context, logger *slog.Logger) {
	pingTicker := time.NewTicker(pingInterval)
	defer pingTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = c.close()
			return
		case <-c.closed:
			return

		case ev, ok := <-c.send:
			if !ok {
				return
			}
			payload, err := json.Marshal(ev)
			if err != nil {
				logger.Warn("ws marshal failed",
					slog.Uint64("conn_id", c.id),
					slog.String("error", err.Error()),
				)
				continue
			}
			writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			err = c.conn.Write(writeCtx, websocket.MessageText, payload)
			cancel()
			if err != nil {
				logger.Info("ws write failed; closing conn",
					slog.Uint64("conn_id", c.id),
					slog.String("error", err.Error()),
				)
				_ = c.close()
				return
			}

		case <-pingTicker.C:
			pingCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				logger.Info("ws ping failed; closing conn",
					slog.Uint64("conn_id", c.id),
					slog.String("error", err.Error()),
				)
				_ = c.close()
				return
			}
		}
	}
}

// runReader drains inbound frames. MVP doesn't accept any client-side
// business messages — we just need to detect disconnect and consume
// any client pings. Any read error closes the connection.
func (c *Connection) runReader(ctx context.Context, logger *slog.Logger) {
	for {
		_, _, err := c.conn.Read(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				logger.Debug("ws read returned",
					slog.Uint64("conn_id", c.id),
					slog.String("error", err.Error()),
				)
			}
			_ = c.close()
			return
		}
		// Client sent a frame — MVP ignores body, just keeps reading.
	}
}

// close is idempotent. Called from either reader/writer goroutine OR the
// hub release function (whichever fires first).
func (c *Connection) close() error {
	var err error
	c.closeOnce.Do(func() {
		close(c.closed)
		err = c.conn.Close(websocket.StatusNormalClosure, "")
	})
	return err
}
