// Package email provides an SMTP email client with HTML template rendering,
// retry queue (email_outbox), and a simple async dispatch API.
//
// PR-NOTIFY: email gönderim altyapısı — şifre sıfırlama, bildirim, güvenlik
// uyarıları gibi işlem e-postalarını merkezi olarak yönetir.
package email

import (
	"bytes"
	"context"
	"crypto/tls"
	"embed"
	"fmt"
	"html/template"
	"log/slog"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed templates/*.html
var templateFS embed.FS

// TLSMode belirler SMTP bağlantısının TLS davranışını.
type TLSMode string

const (
	TLSModeNone     TLSMode = "none"     // düz metin (yalnızca dev/internal)
	TLSModeSTARTTLS TLSMode = "starttls" // STARTTLS yükseltme (varsayılan)
	TLSModeTLS      TLSMode = "tls"      // doğrudan TLS (port 465)
)

// Config, SMTP bağlantı parametrelerini tutar.
type Config struct {
	Host     string  // ENVANTER_SMTP_HOST
	Port     int     // ENVANTER_SMTP_PORT (varsayılan 587)
	Username string  // ENVANTER_SMTP_USER
	Password string  // ENVANTER_SMTP_PASSWORD
	From     string  // ENVANTER_SMTP_FROM (e.g. "IronStock <noreply@example.com>")
	TLSMode  TLSMode // ENVANTER_SMTP_TLS: none|starttls|tls (varsayılan starttls)
	AppURL   string  // frontend URL (reset linki için gerekli)
}

// IsConfigured SMTP config'inin kullanılabilir olduğunu kontrol eder.
func (c Config) IsConfigured() bool {
	return c.Host != "" && c.Port > 0
}

// Client, e-posta gönderme işlemlerini sarmalar.
type Client struct {
	cfg    Config
	tmpl   *template.Template
	db     *pgxpool.Pool
	logger *slog.Logger
}

// New yeni bir Client döner; template'ları parse eder.
func New(cfg Config, db *pgxpool.Pool, logger *slog.Logger) (*Client, error) {
	t, err := parseTemplates()
	if err != nil {
		return nil, fmt.Errorf("email template parse: %w", err)
	}
	return &Client{cfg: cfg, tmpl: t, db: db, logger: logger}, nil
}

// TemplateData, tüm HTML template'ların ortak alanlarını içerir.
type TemplateData struct {
	Subject  string
	AppURL   string
	Username string
	// Şablon-spesifik alanlar — her şablonda ihtiyaç duyulana göre doldurulur.
	ResetURL    string
	ExpiresIn   string
	RequestedAt string
	IPAddress   string
	UserAgent   string
	AlertType   string
	Description string
	OccurredAt  string
	Email       string
	Role        string
	ItemID      string
	ItemName    string
	ItemType    string
	ExpiresAt   string
	// Digest
	Notifications []DigestNotification
}

// DigestNotification, notification_digest template'ında kullanılır.
type DigestNotification struct {
	Title     string
	Body      string
	CreatedAt string
}

// SendTemplate, belirtilen template'ı render edip e-posta gönderir.
// Hata durumunda email_outbox'a pending olarak ekler (retry queue).
func (c *Client) SendTemplate(ctx context.Context, to, templateName string, data TemplateData) error {
	if !c.cfg.IsConfigured() {
		c.logger.Warn("smtp not configured — e-posta atlandı",
			slog.String("template", templateName),
			slog.String("to", to),
		)
		return nil
	}

	data.AppURL = c.cfg.AppURL

	// Subject'i template'dan al
	var subjectBuf bytes.Buffer
	if err := c.tmpl.ExecuteTemplate(&subjectBuf, "subject_"+templateName, data); err != nil {
		// fallback: data.Subject alanını kullan
		if data.Subject == "" {
			data.Subject = "IronStock Bildirimi"
		}
	} else {
		data.Subject = subjectBuf.String()
	}

	// HTML body render
	var bodyBuf bytes.Buffer
	if err := c.tmpl.ExecuteTemplate(&bodyBuf, templateName, data); err != nil {
		return fmt.Errorf("template render (%s): %w", templateName, err)
	}

	if err := c.send(to, data.Subject, bodyBuf.String()); err != nil {
		// Gönderim başarısız: outbox'a ekle
		c.logger.Warn("smtp send failed, outbox'a ekleniyor",
			slog.String("to", to),
			slog.String("template", templateName),
			slog.String("error", err.Error()),
		)
		_ = c.enqueue(ctx, to, data.Subject, templateName, data)
		return err
	}
	return nil
}

// SendTemplateAsync, SendTemplate'ı goroutine içinde çağırır.
func (c *Client) SendTemplateAsync(to, templateName string, data TemplateData) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := c.SendTemplate(ctx, to, templateName, data); err != nil {
			c.logger.Warn("async email send failed",
				slog.String("to", to),
				slog.String("template", templateName),
				slog.String("error", err.Error()),
			)
		}
	}()
}

// send, SMTP üzerinden HTML e-posta gönderir. Exponential backoff ile 3 deneme.
func (c *Client) send(to, subject, htmlBody string) error {
	msg := buildMIME(c.cfg.From, to, subject, htmlBody)

	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if err := c.dialAndSend(to, msg); err != nil {
			lastErr = err
			c.logger.Warn("smtp attempt failed",
				slog.Int("attempt", attempt),
				slog.String("error", err.Error()),
			)
			if attempt < 3 {
				backoff := time.Duration(attempt*attempt) * time.Second
				time.Sleep(backoff)
			}
			continue
		}
		return nil
	}
	return fmt.Errorf("tüm SMTP denemeleri başarısız: %w", lastErr)
}

func (c *Client) dialAndSend(to, msg string) error {
	addr := net.JoinHostPort(c.cfg.Host, fmt.Sprintf("%d", c.cfg.Port))

	switch c.cfg.TLSMode {
	case TLSModeTLS:
		// Port 465: doğrudan TLS
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: c.cfg.Host})
		if err != nil {
			return fmt.Errorf("tls dial: %w", err)
		}
		client, err := smtp.NewClient(conn, c.cfg.Host)
		if err != nil {
			return fmt.Errorf("smtp client: %w", err)
		}
		defer client.Close()
		return c.smtpSend(client, to, msg)

	case TLSModeNone:
		// Düz metin — sadece internal relay için
		client, err := smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("smtp dial: %w", err)
		}
		defer client.Close()
		return c.smtpSend(client, to, msg)

	default:
		// STARTTLS (varsayılan)
		conn, err := net.Dial("tcp", addr)
		if err != nil {
			return fmt.Errorf("tcp dial: %w", err)
		}
		client, err := smtp.NewClient(conn, c.cfg.Host)
		if err != nil {
			return fmt.Errorf("smtp client: %w", err)
		}
		defer client.Close()
		if err := client.StartTLS(&tls.Config{ServerName: c.cfg.Host}); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
		return c.smtpSend(client, to, msg)
	}
}

func (c *Client) smtpSend(client *smtp.Client, to, msg string) error {
	if c.cfg.Username != "" {
		auth := smtp.PlainAuth("", c.cfg.Username, c.cfg.Password, c.cfg.Host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	fromAddr, err := mail.ParseAddress(c.cfg.From)
	if err != nil {
		return fmt.Errorf("from address parse: %w", err)
	}

	if err := client.Mail(fromAddr.Address); err != nil {
		return fmt.Errorf("smtp MAIL: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp RCPT: %w", err)
	}

	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	defer wc.Close()

	if _, err := wc.Write([]byte(msg)); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	return nil
}

// enqueue, başarısız e-postayı email_outbox tablosuna ekler.
func (c *Client) enqueue(ctx context.Context, to, subject, templateName string, data TemplateData) error {
	if c.db == nil {
		return nil
	}
	// data'yı jsonb'ye çevirmek için basit bir yol
	const sqlText = `
		INSERT INTO email_outbox (to_address, subject, template_name, template_data, status, next_retry_at)
		VALUES ($1, $2, $3, $4::jsonb, 'pending', now() + interval '5 minutes')
	`
	dataJSON := templateDataToJSON(data)
	_, err := c.db.Exec(ctx, sqlText, to, subject, templateName, dataJSON)
	return err
}

// buildMIME, MIME-encoded HTML e-posta mesajı oluşturur.
func buildMIME(from, to, subject, htmlBody string) string {
	var sb strings.Builder
	sb.WriteString("From: ")
	sb.WriteString(from)
	sb.WriteString("\r\nTo: ")
	sb.WriteString(to)
	sb.WriteString("\r\nSubject: ")
	sb.WriteString(subject)
	sb.WriteString("\r\nMIME-Version: 1.0\r\n")
	sb.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
	sb.WriteString(htmlBody)
	return sb.String()
}

// parseTemplates, embed'li HTML dosyalarını parse eder.
// Her dosya hem "base" hem "content" block tanımlar.
func parseTemplates() (*template.Template, error) {
	entries, err := templateFS.ReadDir("templates")
	if err != nil {
		return nil, err
	}

	// Her template dosyası için base.html ile birleştirip parse et
	baseHTML, err := templateFS.ReadFile("templates/base.html")
	if err != nil {
		return nil, fmt.Errorf("base.html okunamadı: %w", err)
	}

	master := template.New("master")

	for _, e := range entries {
		if e.Name() == "base.html" || !strings.HasSuffix(e.Name(), ".html") {
			continue
		}
		tplHTML, err := templateFS.ReadFile("templates/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("%s okunamadı: %w", e.Name(), err)
		}

		// Her şablon dosyası {{define "subject"}} ve {{define "content"}} içerir.
		// "subject_<name>" ve "<name>" adıyla register et.
		name := strings.TrimSuffix(e.Name(), ".html")

		// subject template
		subjectTmpl := template.Must(master.New("subject_" + name).Parse(
			`{{template "subject" .}}`))
		if _, err := subjectTmpl.Parse(string(tplHTML)); err != nil {
			return nil, fmt.Errorf("subject parse %s: %w", name, err)
		}

		// full template (base + content)
		fullHTML := string(baseHTML) + "\n" + string(tplHTML)
		if _, err := master.New(name).Parse(fullHTML); err != nil {
			return nil, fmt.Errorf("full parse %s: %w", name, err)
		}
	}

	return master, nil
}

// templateDataToJSON, TemplateData'yı basit JSON formatına çevirir.
func templateDataToJSON(d TemplateData) string {
	// Minimal JSON serialization — outbox için yeterli
	var sb strings.Builder
	sb.WriteString(`{"username":`)
	sb.WriteString(jsonStr(d.Username))
	sb.WriteString(`,"reset_url":`)
	sb.WriteString(jsonStr(d.ResetURL))
	sb.WriteString(`,"expires_in":`)
	sb.WriteString(jsonStr(d.ExpiresIn))
	sb.WriteString(`,"ip_address":`)
	sb.WriteString(jsonStr(d.IPAddress))
	sb.WriteString(`,"item_name":`)
	sb.WriteString(jsonStr(d.ItemName))
	sb.WriteString(`}`)
	return sb.String()
}

func jsonStr(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}
