# Envanter App — Claude Context

Bu dosya her Claude Code session'ında otomatik yüklenir. Proje hakkında kalıcı bağlam sağlar.

## Proje Özeti

DevOps/SRE takımı için envanter yönetim uygulaması. KeePassXC'ye alternatif olarak geliştirilen, merkezi + canlı sync'li + MFA destekli sistem.

**Kapsam:**
- Server: Kubernetes üzerinde, Go tabanlı REST + WebSocket API
- Web Admin UI: React + Vite + TypeScript — kullanıcı/rol yönetimi, envanter görüntüleme
- Client: Tauri (Rust) — Windows + macOS native, ağaç UI + offline cache
- Auth: Username + password (Argon2id) + TOTP (RFC 6238, Google Authenticator uyumlu) + Trusted Device (30 gün cookie)
- **3-katmanlı RBAC:**
  - Global rol: `admin` / `write` / `read`
  - Klasör-level ACL: `folder_permissions` (inherit_to_children) + `folder_group_permissions` (grup bazlı)
  - Item-level share: `item_shares` (per-user wrapped DEK) + `item_share_links` (one-time public links)
- **Gruplar:** `groups` + `group_members` — grup bazlı klasör izni (PR-F6a/b)
- **Dinamik veri modeli:** `item_types` (server/url/database/ssh_key/…) + `field_definitions` (merkezi field sözlüğü, hostname/ip_address/environment vs), `item_relationships` (hosted_on, accessed_via, depends_on, uses_tool, builds_to, scans_with, deploys_to…).
- **Versiyonlama:** `item_field_versions` — max 10 versiyon, FIFO (PR-N2)
- **Etiketler + Favoriler:** `tags`, `item_tags`, `user_favorites` (PR-N7)
- **Bildirimler:** `notifications` — in-app + WS push (PR-N8)
- **Credential expiry:** `items.expires_at/rotation_interval_days/last_rotated_at` + nightly scanner (PR-N1)
- **Break-glass:** `users.is_break_glass` — acil erişim, tüm adminlere anlık uyarı (PR-N4)
- **One-time share:** `item_share_links` — token_hash + dek_wrapped, link_key URL fragment'ta (PR-N5)
- **External secret backends:** HashiCorp Vault proxy (Faz 5, parking) — ADR-0007.

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
| Container images | Multi-stage Dockerfile, native cross-compile (server: alpine+goose embed, web: nginx) → GHCR |
| Deploy | Raw k8s YAML + ArgoCD GitOps + DB migration init container (Helm Faz 5'te değerlendirilecek; ADR-0008) |
| CI | GitHub Actions (server + pre-commit + docker multi-arch ~8dk) |
| Secrets | `kubectl create secret` (Sealed Secrets/External Secrets Operator Faz 5'te) |

## Güvenlik Modeli (Hibrit)

- **Metadata** (item isim, IP, hostname, klasör yapısı, hardware specs): server-side envelope encryption — master key KMS'te, per-item DEK.
- **Secret field'lar** (parola, private key, token, URL credential): client-side E2E — kullanıcı master parolasından Argon2id ile türetilen key ile şifrelenir. Server plaintext'i asla görmez.
- **Paylaşılan item'lar**: per-item DEK üretilir, yetkili kullanıcıların public key'leri (X25519) ile wrap edilir.
- **Audit log**: server-side plaintext (uyumluluk ve okunabilirlik için).
- **Vault-backed item'lar**: Envanter path referansı tutar, secret'ı DB'ye yazmaz. Erişim anında Vault'tan canlı çekilir (proxy). Detay ADR-0007.

Detaylı tasarım: [docs/adr/0002-security-model.md](docs/adr/0002-security-model.md) (Faz 1'de yazıldı) + [docs/adr/0004-encryption-details.md](docs/adr/0004-encryption-details.md) (algoritma detayları).

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

## İş Bölümü — Çift Makine Workflow (▶ Faz 3'te aktif, Post-v1.0.0'da tek makine)

**Mevcut durum (2026-05-16):** Post-v1.0.0 Kapsamlı Geliştirme Planı kapsamındaki 17 PR tamamlandı (PR-RT-1 → PR-N5). Tek makine (Win) ile çalışılıyor. Kalan: PR-F3 (Tauri Sync), PR-N3 (büyük iş, ayrı plan).

**Stack kararları (Faz 3):** ADR-0009 — Zustand + TanStack Query + Tailwind 4 + shadcn/ui + argon2-browser + WS subprotocol auth.

**Migration sayısı (2026-05-16):** En son migration `00031_share_links.sql`. Yeni migration eklerken sıradaki numara `00032`.

## Her Session'da Yapılacaklar

1. `PROGRESS.md` oku — aktif faz ve son durum.
2. `TODO.md` oku — sıradaki task.
3. `RULES.md`'yi dikkate al — kod/commit/test kuralları.
4. İş bitince: `PROGRESS.md` güncelle (günlük entry), `TODO.md` işaretle, gerekirse `RULES.md`'ye yeni kural ekle.

## Kritik Kurallar (Özet)

Tam liste: `RULES.md`.

- Secret field (parola, token, private key) asla plaintext log'lanmaz **veya repo'ya commit edilmez** (`secret.yaml` gibi). `.gitignore` + Sealed Secrets / SOPS pattern'i kullanılır.
- Test yazılmadan public API merge edilmez.
- Her mimari karar `docs/adr/` altında ADR olarak yazılır.
- Her task sonunda `PROGRESS.md` güncellenir (aynı commit içinde).
- Conventional Commits formatı zorunlu.
- Repos canonical, Claude-Chat legacy (RULES.md "Repo Konumu" bölümü).
