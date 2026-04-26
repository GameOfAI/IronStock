package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

// helper: hit a limited handler N times from the same IP, return statuses.
func hitN(t *testing.T, mw func(http.Handler) http.Handler, n int, ip string) []int {
	t.Helper()
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	got := make([]int, 0, n)
	for i := 0; i < n; i++ {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		req.RemoteAddr = ip
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		got = append(got, w.Code)
	}
	return got
}

func TestRateLimiter_BurstAllowed(t *testing.T) {
	rl := NewIPRateLimiter(rate.Every(1*time.Hour), 3) // sustained = 1/hour, burst 3
	codes := hitN(t, rl.Middleware, 3, "10.0.0.1:1234")
	for i, c := range codes {
		if c != http.StatusOK {
			t.Errorf("burst[%d] status = %d, want 200", i, c)
		}
	}
}

func TestRateLimiter_OverBurstReturns429(t *testing.T) {
	rl := NewIPRateLimiter(rate.Every(1*time.Hour), 2)
	codes := hitN(t, rl.Middleware, 4, "10.0.0.2:1234")
	if codes[0] != 200 || codes[1] != 200 {
		t.Errorf("first 2 = %v, want both 200", codes[:2])
	}
	if codes[2] != http.StatusTooManyRequests || codes[3] != http.StatusTooManyRequests {
		t.Errorf("over burst = %v, want both 429", codes[2:])
	}
}

func TestRateLimiter_PerIPSeparation(t *testing.T) {
	rl := NewIPRateLimiter(rate.Every(1*time.Hour), 1)

	// IP A burns its single token.
	codes := hitN(t, rl.Middleware, 2, "10.0.0.10:1234")
	if codes[0] != 200 || codes[1] != http.StatusTooManyRequests {
		t.Errorf("IP A pattern = %v, want [200, 429]", codes)
	}

	// IP B has its own bucket — first call must still pass.
	codes = hitN(t, rl.Middleware, 1, "10.0.0.20:1234")
	if codes[0] != 200 {
		t.Errorf("IP B = %d, want 200", codes[0])
	}
}

func TestRateLimiter_RetryAfterHeader(t *testing.T) {
	rl := NewIPRateLimiter(rate.Every(1*time.Hour), 1)
	mw := rl.Middleware

	// First request: passes.
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.RemoteAddr = "10.0.0.30:1234"
	w := httptest.NewRecorder()
	mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {})).ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("first req = %d", w.Code)
	}

	// Second: 429 with Retry-After.
	req = httptest.NewRequest(http.MethodPost, "/x", nil)
	req.RemoteAddr = "10.0.0.30:1234"
	w = httptest.NewRecorder()
	mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {})).ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("second req = %d, want 429", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("missing Retry-After header on 429")
	}
}

func TestClientIP_StripsPort(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "192.168.1.5:54321"
	if got := clientIP(r); got != "192.168.1.5" {
		t.Errorf("clientIP = %q, want 192.168.1.5", got)
	}
}

func TestClientIP_NoPort(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.7"
	if got := clientIP(r); got != "203.0.113.7" {
		t.Errorf("clientIP = %q, want 203.0.113.7", got)
	}
}

func TestClientIP_Empty(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = ""
	if got := clientIP(r); got != "unknown" {
		t.Errorf("clientIP empty = %q, want unknown", got)
	}
}
