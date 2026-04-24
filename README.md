# Envanter App

DevOps/SRE takımı için merkezi envanter yönetim uygulaması. KeePassXC'ye alternatif olarak tasarlandı — canlı sync, MFA, RBAC ve offline destek içerir.

## Durum

**Aktif geliştirme.** Güncel faz ve durum için [PROGRESS.md](PROGRESS.md), yapılacaklar için [TODO.md](TODO.md).

## Mimari

```
┌─────────────────────────┐        ┌────────────────────────┐
│  Tauri Client (Win+Mac) │◄──────►│                        │
└─────────────────────────┘  WSS   │   Go Server (k8s)      │
                                   │                        │
┌─────────────────────────┐  HTTPS │   - REST API           │
│  Admin Web UI (React)   │◄──────►│   - WebSocket hub      │
└─────────────────────────┘        │   - Postgres 16        │
                                   └────────────────────────┘
```

## Özellikler

- **Auth:** Username + password (Argon2id) + TOTP (RFC 6238)
- **RBAC:** read / write rolleri
- **Hibrit şifreleme:**
  - Metadata → server-side envelope encryption (AES-256-GCM)
  - Secret field'lar → client-side E2E (kullanıcı master key'i ile)
- **Live sync:** WebSocket üzerinden anlık güncelleme
- **Offline cache:** Client bağlantısı koparsa son veriye şifreli erişim
- **Audit log:** Tüm yazma işlemleri kayıt altında

## Dizin Yapısı

```
server/    # Go backend (REST + WebSocket API)
client/    # Tauri desktop app (Windows + macOS)
web/       # React admin web UI
shared/    # OpenAPI spec + otomatik üretilen tipler
deploy/    # Helm chart + Docker Compose
docs/      # Mimari, ADR'ler, diyagramlar
```

## Hızlı Başlangıç (geliştirici)

Gereksinimler: Docker, Go 1.22+, Node 20+, Rust 1.75+

```bash
make up          # Dev stack (Postgres + Adminer + Mailhog)
make build       # Server + web + client build
make test        # Tüm testler
make lint        # Tüm linter'lar
make down        # Dev stack kapat
```

Detay komutlar için `make help`.

## Dokümantasyon

| Dosya | İçerik |
|-------|--------|
| [CLAUDE.md](CLAUDE.md) | Proje context (Claude Code için) |
| [PROGRESS.md](PROGRESS.md) | Faz durumu + günlük |
| [RULES.md](RULES.md) | Geliştirme kuralları |
| [TODO.md](TODO.md) | Yapılacaklar listesi |
| [docs/adr/](docs/adr/) | Mimari kararlar (ADR) |

## Lisans

Proprietary — internal project.
