// Package logging provides structured logging using log/slog.
//
// Two policies are baked in (RULES.md güvenlik kuralı):
//   - Secret-looking attribute keys are redacted at the handler level.
//     Defense-in-depth alongside per-call discipline.
//   - Default format is JSON, suitable for log aggregation pipelines.
package logging

import (
	"io"
	"log/slog"
	"os"
	"strings"
)

// New returns a logger writing to os.Stdout with the given level and format.
func New(level, format string) *slog.Logger {
	return NewWithWriter(os.Stdout, level, format)
}

// NewWithWriter is like New but writes to the given io.Writer.
// Useful for tests and alternate sinks.
func NewWithWriter(w io.Writer, level, format string) *slog.Logger {
	lvl := parseLevel(level)
	opts := &slog.HandlerOptions{
		Level:       lvl,
		AddSource:   lvl == slog.LevelDebug,
		ReplaceAttr: redactSecrets,
	}
	var h slog.Handler
	if strings.EqualFold(format, "text") {
		h = slog.NewTextHandler(w, opts)
	} else {
		h = slog.NewJSONHandler(w, opts)
	}
	return slog.New(h)
}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error", "err":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// secretKeySubstrings: attribute keys containing any of these strings
// (case-insensitive) get redacted. Conservative list — false positives
// preferred over leaks.
var secretKeySubstrings = []string{
	"password", "passwd",
	"secret",
	"token",
	"api_key", "apikey",
	"private_key", "privatekey",
	"auth", // covers authorization, auth_header, etc.
	"cookie",
	"credential",
	"totp",
}

// redactSecrets replaces values of secret-looking keys with "[REDACTED]".
// Called by slog for every attribute logged.
func redactSecrets(_ []string, a slog.Attr) slog.Attr {
	key := strings.ToLower(a.Key)
	for _, needle := range secretKeySubstrings {
		if strings.Contains(key, needle) {
			return slog.Attr{Key: a.Key, Value: slog.StringValue("[REDACTED]")}
		}
	}
	return a
}
