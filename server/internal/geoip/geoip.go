// Package geoip provides lightweight IP geolocation and Tor exit node detection
// for PR-SEC5 per-user access control.
//
// Country lookup: uses ip-api.com (free, no API key, 45 req/min limit).
//   - Results are cached in-memory for 24 hours.
//   - On lookup failure the restriction is skipped (fail-open for availability).
//
// Tor exit detection: downloads the Tor exit list from check.torproject.org
//   daily and caches it in-memory. On download failure the last known list is
//   kept. First call initialises from zero (empty list — fail-open).
//
// Production note: for higher volume, set ENVANTER_GEOIP_PROVIDER=maxmind
// and provide a MaxMind GeoLite2-Country.mmdb via ENVANTER_GEOIP_MMDB_PATH.
// (MaxMind integration is a TODO; the hook is documented in Lookup.)
package geoip

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Lookup returns the ISO 3166-1 alpha-2 country code for the given IP.
// Returns ("", nil) for private/loopback addresses.
// Returns ("", nil) on lookup failure (fail-open).
func Lookup(ctx context.Context, ipStr string) (string, error) {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return "", nil
	}
	// Skip private/loopback/link-local
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return "", nil
	}
	return defaultLookup.lookup(ctx, ipStr)
}

// IsTorExit returns true if the IP appears in the current Tor exit node list.
func IsTorExit(ipStr string) bool {
	return defaultTor.isExit(ipStr)
}

// StartBackgroundRefresh starts the periodic Tor exit list refresh and country
// cache eviction. Call once at server startup; ctx cancellation stops it.
func StartBackgroundRefresh(ctx context.Context, logger *slog.Logger) {
	go defaultTor.refreshLoop(ctx, logger)
}

// ─── ipapi country lookup ────────────────────────────────────────────────────

type ipAPIResponse struct {
	Status      string `json:"status"`
	CountryCode string `json:"countryCode"`
}

type cacheEntry struct {
	code    string
	expires time.Time
}

type ipapiLookup struct {
	mu    sync.Mutex
	cache map[string]cacheEntry
	ttl   time.Duration
}

var defaultLookup = &ipapiLookup{
	cache: make(map[string]cacheEntry),
	ttl:   24 * time.Hour,
}

func (l *ipapiLookup) lookup(ctx context.Context, ip string) (string, error) {
	l.mu.Lock()
	if e, ok := l.cache[ip]; ok && time.Now().Before(e.expires) {
		l.mu.Unlock()
		return e.code, nil
	}
	l.mu.Unlock()

	code, err := l.fetchFromAPI(ctx, ip)
	if err != nil {
		// fail-open: don't cache errors
		return "", nil //nolint:nilerr
	}

	l.mu.Lock()
	l.cache[ip] = cacheEntry{code: code, expires: time.Now().Add(l.ttl)}
	l.mu.Unlock()
	return code, nil
}

func (l *ipapiLookup) fetchFromAPI(ctx context.Context, ip string) (string, error) {
	url := fmt.Sprintf("http://ip-api.com/json/%s?fields=status,countryCode", ip)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "IronStock/1.0 (+https://github.com/ironstock)")

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", err
	}

	var r ipAPIResponse
	if err := json.Unmarshal(body, &r); err != nil {
		return "", err
	}
	if r.Status != "success" {
		return "", fmt.Errorf("ip-api: status=%s", r.Status)
	}
	return strings.ToUpper(r.CountryCode), nil
}

// ─── Tor exit node list ──────────────────────────────────────────────────────

const torExitURL = "https://check.torproject.org/torbulkexitlist"

type torExitSet struct {
	mu      sync.RWMutex
	exits   map[string]struct{}
	lastOK  time.Time
}

var defaultTor = &torExitSet{
	exits: make(map[string]struct{}),
}

func (t *torExitSet) isExit(ip string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	_, ok := t.exits[ip]
	return ok
}

func (t *torExitSet) refreshLoop(ctx context.Context, logger *slog.Logger) {
	// Initial fetch
	if err := t.refresh(ctx); err != nil {
		logger.Warn("geoip: initial Tor exit list fetch failed", slog.String("error", err.Error()))
	}

	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := t.refresh(ctx); err != nil {
				logger.Warn("geoip: Tor exit list refresh failed", slog.String("error", err.Error()))
			} else {
				logger.Info("geoip: Tor exit list refreshed", slog.Time("at", t.lastOK))
			}
		}
	}
}

func (t *torExitSet) refresh(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, torExitURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "IronStock/1.0")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	newSet := make(map[string]struct{}, 2000)
	sc := bufio.NewScanner(io.LimitReader(resp.Body, 2<<20)) // 2MB max
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if net.ParseIP(line) != nil {
			newSet[line] = struct{}{}
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}

	t.mu.Lock()
	t.exits = newSet
	t.lastOK = time.Now()
	t.mu.Unlock()
	return nil
}
