// Package cache provides a thin Redis client wrapper with circuit-breaker
// semantics for PR-SCALE horizontal scaling.
//
// The package is designed to be optional: when Redis is not configured,
// callers receive a nil *Client and should fall back to in-memory equivalents.
//
// Circuit breaker: after RedisErrThreshold consecutive errors the client
// enters "open" state for CircuitOpenDuration. During this window all
// operations return ErrCircuitOpen immediately. This prevents a flaky Redis
// from cascading into slow timeouts on the hot path.
package cache

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// RedisErrThreshold: consecutive errors before circuit opens.
	RedisErrThreshold = 5
	// CircuitOpenDuration: how long the circuit stays open before half-opening.
	CircuitOpenDuration = 30 * time.Second
)

// ErrCircuitOpen is returned when the circuit breaker is open.
var ErrCircuitOpen = errors.New("redis circuit breaker open")

// Client wraps go-redis with connection health tracking and a simple
// consecutive-error circuit breaker.
type Client struct {
	rdb          *redis.Client
	logger       *slog.Logger
	consecErrors atomic.Int64
	circuitUntil atomic.Int64 // UnixNano; 0 = closed
}

// New creates a Redis client from the given URL and password.
// Returns (nil, nil) if url is empty — callers should treat nil as
// "no Redis; use in-memory fallback".
func New(url, password string, logger *slog.Logger) (*Client, error) {
	if url == "" {
		return nil, nil
	}

	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	if password != "" {
		opts.Password = password
	}
	opts.DialTimeout = 3 * time.Second
	opts.ReadTimeout = 2 * time.Second
	opts.WriteTimeout = 2 * time.Second
	opts.MaxRetries = 1

	rdb := redis.NewClient(opts)

	c := &Client{rdb: rdb, logger: logger}

	// Ping to verify connectivity at startup. Non-fatal — circuit opens if it fails.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Warn("redis: initial ping failed — circuit open; will retry",
			slog.String("error", err.Error()))
		c.recordError()
	} else {
		logger.Info("redis: connected", slog.String("addr", opts.Addr))
	}

	return c, nil
}

// Ping checks liveness of the Redis connection.
func (c *Client) Ping(ctx context.Context) error {
	if c.isOpen() {
		return ErrCircuitOpen
	}
	err := c.rdb.Ping(ctx).Err()
	c.observe(err)
	return err
}

// SetEX sets key = value with TTL. Falls through to nop if circuit is open.
func (c *Client) SetEX(ctx context.Context, key string, value any, ttl time.Duration) error {
	if c.isOpen() {
		return ErrCircuitOpen
	}
	err := c.rdb.Set(ctx, key, value, ttl).Err()
	c.observe(err)
	return err
}

// GetDel atomically gets and deletes a key. Returns ("", redis.Nil) if absent.
func (c *Client) GetDel(ctx context.Context, key string) (string, error) {
	if c.isOpen() {
		return "", ErrCircuitOpen
	}
	val, err := c.rdb.GetDel(ctx, key).Result()
	c.observe(err)
	return val, err
}

// Publish sends a message to a Redis channel.
func (c *Client) Publish(ctx context.Context, channel string, message any) error {
	if c.isOpen() {
		return ErrCircuitOpen
	}
	err := c.rdb.Publish(ctx, channel, message).Err()
	c.observe(err)
	return err
}

// Subscribe returns a pub/sub subscription on the given channel.
// The caller is responsible for calling Close on the returned PubSub.
func (c *Client) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	return c.rdb.Subscribe(ctx, channels...)
}

// Underlying returns the raw go-redis client for advanced use cases.
func (c *Client) Underlying() *redis.Client {
	return c.rdb
}

// Close closes the underlying Redis connection pool.
func (c *Client) Close() error {
	return c.rdb.Close()
}

// IsOpen returns true if the circuit breaker is open (Redis unavailable).
func (c *Client) IsOpen() bool {
	return c.isOpen()
}

func (c *Client) isOpen() bool {
	until := c.circuitUntil.Load()
	if until == 0 {
		return false
	}
	if time.Now().UnixNano() < until {
		return true
	}
	// Half-open: reset so next call goes through
	c.circuitUntil.Store(0)
	c.consecErrors.Store(0)
	c.logger.Info("redis: circuit half-open — allowing probe request")
	return false
}

func (c *Client) recordError() {
	n := c.consecErrors.Add(1)
	if n >= RedisErrThreshold {
		until := time.Now().Add(CircuitOpenDuration).UnixNano()
		c.circuitUntil.Store(until)
		c.logger.Warn("redis: circuit breaker OPEN",
			slog.Int64("consecutive_errors", n),
			slog.Duration("open_for", CircuitOpenDuration))
	}
}

func (c *Client) observe(err error) {
	if err != nil && !errors.Is(err, redis.Nil) {
		c.recordError()
	} else {
		c.consecErrors.Store(0)
	}
}
