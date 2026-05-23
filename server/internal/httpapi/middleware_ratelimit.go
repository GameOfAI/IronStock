package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"envanter.app/server/internal/cache"
)

// IPRateLimiter is a per-IP token bucket. Each unique remote IP gets its own
// rate.Limiter instance, expired entries are pruned by a background sweeper.
//
// This is intentionally simple in-memory. Production scale-out wants a
// shared store (Redis cell-based limiter), tracked in TODO.md Faz 5.
//
// Usage: AuthLogin → 5 req/min burst, then 1/12s sustained.
//
//	rl := NewIPRateLimiter(rate.Every(12*time.Second), 5)
//	r.With(rl.Middleware).Post("/auth/login", h.Login)
type IPRateLimiter struct {
	limit rate.Limit
	burst int

	mu      sync.Mutex
	buckets map[string]*ipBucket

	// idleTimeout is how long a bucket can sit unused before sweep removes it.
	// Default 10 * minute window — keeps memory bounded but tolerates bursts.
	idleTimeout time.Duration
}

type ipBucket struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// NewIPRateLimiter constructs a per-IP limiter. Pass `rate.Every(d)` to mean
// "one event per d", and burst >= 1 for the initial token allowance.
//
// The sweeper goroutine runs for the lifetime of the process. We don't expose
// a Stop() — limiters are constructed once at startup and GC'd at shutdown.
// Tests that need disposal should construct a fresh limiter per case.
func NewIPRateLimiter(limit rate.Limit, burst int) *IPRateLimiter {
	if burst < 1 {
		burst = 1
	}
	rl := &IPRateLimiter{
		limit:       limit,
		burst:       burst,
		buckets:     make(map[string]*ipBucket),
		idleTimeout: 10 * time.Minute,
	}
	go rl.sweepLoop()
	return rl
}

func (rl *IPRateLimiter) get(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	if b, ok := rl.buckets[ip]; ok {
		b.lastSeen = now
		return b.limiter
	}
	b := &ipBucket{
		limiter:  rate.NewLimiter(rl.limit, rl.burst),
		lastSeen: now,
	}
	rl.buckets[ip] = b
	return b.limiter
}

// sweepLoop periodically drops idle buckets to bound memory.
func (rl *IPRateLimiter) sweepLoop() {
	ticker := time.NewTicker(rl.idleTimeout)
	defer ticker.Stop()
	for now := range ticker.C {
		rl.mu.Lock()
		for ip, b := range rl.buckets {
			if now.Sub(b.lastSeen) > rl.idleTimeout {
				delete(rl.buckets, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware enforces the per-IP limit. Over-limit requests get 429 with
// a Retry-After header (rounded up to the next available second).
func (rl *IPRateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		lim := rl.get(ip)
		reservation := lim.Reserve()
		if !reservation.OK() {
			// Limiter is mis-configured (delay > burst window). Bail safe.
			writeRateLimitExceeded(w, time.Second)
			return
		}
		delay := reservation.Delay()
		if delay > 0 {
			reservation.Cancel() // we're rejecting, give the token back
			writeRateLimitExceeded(w, delay)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP returns the trusted client IP. We rely on chi's RealIP middleware
// (configured in NewRouter) to have already canonicalised the address by
// the time we get here.
func clientIP(r *http.Request) string {
	// r.RemoteAddr after RealIP is "ip:port" or just "ip". Strip the port if
	// present. Don't fail — fall through to whatever string is there.
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i > 0 {
		// Treat trailing :port; IPv6 raw with no brackets won't reach here
		// because chi's RealIP normalises.
		host = host[:i]
	}
	if host == "" {
		host = "unknown"
	}
	return host
}

func writeRateLimitExceeded(w http.ResponseWriter, retryAfter time.Duration) {
	secs := int(retryAfter.Seconds())
	if secs < 1 {
		secs = 1
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"code":"rate_limited","message":"Çok fazla istek. Lütfen biraz sonra tekrar deneyin."}`))
}

// --- Redis-backed sliding window rate limiter ---

// RedisIPRateLimiter is a per-IP sliding window rate limiter backed by Redis.
//
// It uses a sorted-set (ZSET) per IP. Each request adds a timestamped entry;
// entries older than the window are pruned atomically before counting.
// Falls back to the in-memory IPRateLimiter when Redis is unavailable.
//
// This limiter is shared across all pods — ideal for multi-replica deployments
// (ENVANTER_RATE_LIMIT_BACKEND=redis).
type RedisIPRateLimiter struct {
	redis    *cache.Client
	fallback *IPRateLimiter
	limit    int           // max requests per window
	window   time.Duration // sliding window length
	keyPfx   string        // Redis key prefix
}

// NewRedisIPRateLimiter constructs a Redis-backed sliding window limiter.
// limit = max requests per window; window = window duration.
// keyPfx is used to namespace Redis keys (e.g. "rl:login").
// When redis is nil or the circuit is open, falls back to the in-memory limiter.
func NewRedisIPRateLimiter(
	redis *cache.Client,
	fallback *IPRateLimiter,
	limit int,
	window time.Duration,
	keyPfx string,
) *RedisIPRateLimiter {
	return &RedisIPRateLimiter{
		redis:    redis,
		fallback: fallback,
		limit:    limit,
		window:   window,
		keyPfx:   keyPfx,
	}
}

// Allow returns true if the request from ip is within the rate limit.
// It increments the counter atomically; returns false when over the limit.
func (r *RedisIPRateLimiter) Allow(ip string) bool {
	if r.redis == nil || r.redis.IsOpen() {
		// Redis unavailable — use in-memory fallback.
		lim := r.fallback.get(ip)
		return lim.Allow()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	key := fmt.Sprintf("%s:%s", r.keyPfx, ip)
	now := time.Now()

	// Lua script — atomic sliding window check + increment:
	//   ZREMRANGEBYSCORE key -inf (now - window)   — remove old entries
	//   ZCARD key                                   — count remaining
	//   ZADD key NX score member                    — add current request
	//   EXPIRE key window_seconds                   — keep key alive
	const script = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local win    = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local winStart = now - win
redis.call('ZREMRANGEBYSCORE', key, '-inf', winStart)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, now)
redis.call('PEXPIRE', key, win)
return 1
`
	res, err := r.redis.Underlying().Eval(
		ctx, script,
		[]string{key},
		now.UnixMilli(),
		r.window.Milliseconds(),
		r.limit,
	).Int()
	if err != nil {
		// Redis error — fall back to in-memory.
		return r.fallback.get(ip).Allow()
	}
	return res == 1
}

// Middleware returns an http.Handler middleware that enforces the sliding window limit.
func (r *RedisIPRateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ip := clientIP(req)
		if !r.Allow(ip) {
			writeRateLimitExceeded(w, r.window)
			return
		}
		next.ServeHTTP(w, req)
	})
}
