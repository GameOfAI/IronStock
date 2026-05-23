package geoip

import (
	"context"
	"fmt"
	"net"
	"strings"
)

// IPRestrictions holds the per-user IP access control settings.
type IPRestrictions struct {
	AllowedCIDRs        []string // empty = allow all
	AllowedCountryCodes []string // empty = allow all (ISO 3166-1 alpha-2)
	DenyTorExit         bool
}

// CheckResult is the outcome of CheckIP.
type CheckResult struct {
	Allowed bool
	Reason  string // "ip_denied" | "country_denied" | "tor_denied" | ""
}

// CheckIP evaluates the client IP against the user's restrictions.
// Returns CheckResult{Allowed:true} if all checks pass.
// GeoIP lookup is skipped when AllowedCountryCodes is empty.
func CheckIP(ctx context.Context, clientIP string, r IPRestrictions) CheckResult {
	// 1. CIDR whitelist
	if len(r.AllowedCIDRs) > 0 {
		allowed := false
		for _, cidr := range r.AllowedCIDRs {
			cidr = strings.TrimSpace(cidr)
			if cidr == "" {
				continue
			}
			// Handle plain IP (no mask) as /32 or /128
			if !strings.Contains(cidr, "/") {
				if isIPv6(cidr) {
					cidr += "/128"
				} else {
					cidr += "/32"
				}
			}
			_, network, err := net.ParseCIDR(cidr)
			if err != nil {
				continue
			}
			if network.Contains(net.ParseIP(clientIP)) {
				allowed = true
				break
			}
		}
		if !allowed {
			return CheckResult{Allowed: false, Reason: "ip_denied"}
		}
	}

	// 2. Tor exit node check
	if r.DenyTorExit && IsTorExit(clientIP) {
		return CheckResult{Allowed: false, Reason: "tor_denied"}
	}

	// 3. Country check (only if restriction is set)
	if len(r.AllowedCountryCodes) > 0 {
		code, _ := Lookup(ctx, clientIP)
		if code == "" {
			// Private/loopback or lookup failure → skip country check
		} else {
			allowed := false
			for _, c := range r.AllowedCountryCodes {
				if strings.EqualFold(c, code) {
					allowed = true
					break
				}
			}
			if !allowed {
				return CheckResult{Allowed: false, Reason: "country_denied"}
			}
		}
	}

	return CheckResult{Allowed: true}
}

// ParseCIDRList parses a comma-separated list of CIDR strings.
// Returns an error if any entry is invalid.
func ParseCIDRList(s string) ([]string, error) {
	if s == "" {
		return nil, nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if !strings.Contains(p, "/") {
			// plain IP — accept as-is (CheckIP normalises it)
			if net.ParseIP(p) == nil {
				return nil, fmt.Errorf("invalid IP or CIDR: %q", p)
			}
		} else {
			if _, _, err := net.ParseCIDR(p); err != nil {
				return nil, fmt.Errorf("invalid CIDR %q: %w", p, err)
			}
		}
		out = append(out, p)
	}
	return out, nil
}

func isIPv6(s string) bool {
	return strings.Contains(s, ":")
}
