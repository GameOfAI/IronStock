package logfwd

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
)

// SyslogForwarder sends RFC-5424 syslog messages over UDP or TCP.
// It does not use the standard library's log/syslog package so it
// works cross-platform (the stdlib package is Unix-only).
type SyslogForwarder struct {
	id   string
	cfg  SyslogConfig
	conn net.Conn
}

// NewSyslogForwarder dials the syslog target and returns a ready forwarder.
func NewSyslogForwarder(configID string, cfg SyslogConfig) (*SyslogForwarder, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	conn, err := net.DialTimeout(cfg.Protocol, addr, 5*time.Second)
	if err != nil {
		return nil, fmt.Errorf("logfwd: syslog dial %s %s: %w", cfg.Protocol, addr, err)
	}
	return &SyslogForwarder{id: configID, cfg: cfg, conn: conn}, nil
}

// ConfigID implements Forwarder.
func (f *SyslogForwarder) ConfigID() string { return f.id }

// Close implements Forwarder.
func (f *SyslogForwarder) Close() error { return f.conn.Close() }

// Send encodes the event as an RFC-5424 syslog message and writes it.
// Priority = 14 (facility=user(1), severity=info(6)).
func (f *SyslogForwarder) Send(_ context.Context, ev Event) error {
	details := ""
	if len(ev.Details) > 0 {
		details = " details=" + strings.ReplaceAll(string(ev.Details), " ", "_")
	}

	actorID := "-"
	if ev.ActorUserID != nil {
		actorID = *ev.ActorUserID
	}
	resType := "-"
	if ev.ResourceType != nil {
		resType = *ev.ResourceType
	}
	resID := "-"
	if ev.ResourceID != nil {
		resID = *ev.ResourceID
	}

	// RFC-5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
	msg := fmt.Sprintf(
		"<14>1 %s - %s - - - action=%s actor=%s resource_type=%s resource_id=%s%s\n",
		ev.CreatedAt.UTC().Format(time.RFC3339),
		f.cfg.AppName,
		ev.Action,
		actorID,
		resType,
		resID,
		details,
	)

	_ = f.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, err := fmt.Fprint(f.conn, msg)
	return err
}

// TestMessage sends a synthetic test event to verify connectivity.
func (f *SyslogForwarder) TestMessage() error {
	raw, _ := json.Marshal(map[string]string{"test": "true"})
	return f.Send(context.Background(), Event{
		ID:        "test",
		Action:    "log_forwarding.test",
		Details:   raw,
		CreatedAt: time.Now(),
	})
}
