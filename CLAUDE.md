# Envanter App — Claude Context

Bu dosya her Claude Code session'ında otomatik yüklenir. Proje hakkında kalıcı bağlam sağlar.

## Proje Özeti

DevOps/SRE takımı için envanter yönetim uygulaması. KeePassXC'ye alternatif olarak geliştirilen, merkezi + canlı sync'li + MFA destekli sistem.

**Kapsam:**
- Server: Kubernetes üzerinde, Go tabanlı REST + WebSocket API
- Web Admin UI: React + Vite + TypeScript — kullanıcı/rol yönetimi, envanter görüntüleme
- Client: Tauri (Rust) — Windows + macOS native, ağaç UI + offline cache
- Auth: Username + password (Argon2id) + TOTP (RFC 6238, Google Authenticator uyumlu)
- RBAC: read / write rolleri

## Tech Stack

| Katman | Teknoloji |
|--------|-----------|
| Backend dili | Go 1.22+ |
| Client framework | Tauri 2.x (Rust + Vite frontend) |
| Admin web | React + Vite + TypeScript |
| Veritabanı | PostgreSQL 16 |
| Şifreleme | AES-256-GCM (envelope) + X25519 (key wrap) |
| Auth | Argon2id (password) + TOTP + JWT session |
| Dev stack | Docker Compose |
| Deploy | Kubernetes + Helm |
| CI | GitHub Actions |

## Güvenlik Modeli (Hibrit)

- **Metadata** (item isim, IP, hostname, klasör yapısı, hardware specs): server-side envelope encryption — master key KMS'te, per-item DEK.
- **Secret field'lar** (parola, private key, token, URL credential): client-side E2E — kullanıcı master parolasından Argon2id ile türetilen key ile şifrelenir. Server plaintext'i asla görmez.
- **Paylaşılan item'lar**: per-item DEK üretilir, yetkili kullanıcıların public key'leri (X25519) ile wrap edilir.
- **Audit log**: server-side plaintext (uyumluluk ve okunabilirlik için).

Detaylı tasarım: `docs/adr/0002-security-model.md` (Faz 1'de yazılacak).

## Dizin Yapısı

```
Envanter_App/
├── server/                  # Go backend (cmd/, internal/, migrations/)
├── client/                  # Tauri app (src-tauri/ + src/)
├── web/                     # Admin UI (React + Vite)
├── shared/                  # OpenAPI spec + generated types
├── deploy/                  # Helm chart + docker-compose
├── docs/                    # Mimari, ADR'ler, diyagramlar
│   └── adr/                 # Architecture Decision Records
├── .github/workflows/       # CI tanımları
├── CLAUDE.md                # Bu dosya
├── PROGRESS.md              # Faz durumu + günlük
├── RULES.md                 # Development kuralları
├── TODO.md                  # Aktif + gelecek task'lar
├── README.md                # Kullanıcı-yüzü dokümantasyon
└── Makefile                 # Ortak komutlar
```

## İletişim ve Çalışma Tarzı

- **Dil:** Türkçe (kullanıcı tercihi).
- **Planlama:** Mimari kararlar detaylı planlanır. Koda başlamadan önce tasarımda mutabık kalınır.
- **Faz bazlı ilerleme:** Aynı anda bir faz aktif. Faz bitmeden sonraki başlamaz.
- **TodoWrite eşleniği:** Aktif faz task'ları TodoWrite'ta tutulur, `TODO.md` kalıcı yansımadır.

## Her Session'da Yapılacaklar

1. `PROGRESS.md` oku — aktif faz ve son durum.
2. `TODO.md` oku — sıradaki task.
3. `RULES.md`'yi dikkate al — kod/commit/test kuralları.
4. İş bitince: `PROGRESS.md` güncelle (günlük entry), `TODO.md` işaretle, gerekirse `RULES.md`'ye yeni kural ekle.

## Kritik Kurallar (Özet)

Tam liste: `RULES.md`.

- Secret field (parola, token, private key) asla plaintext log'lanmaz.
- Test yazılmadan public API merge edilmez.
- Her mimari karar `docs/adr/` altında ADR olarak yazılır.
- Her task sonunda `PROGRESS.md` güncellenir.
- Conventional Commits formatı zorunlu.
