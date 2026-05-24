# IronStock — Claude Context

Bu dosya her Claude Code session'ında otomatik yüklenir. Proje hakkında kalıcı bağlam sağlar.

## Proje Özeti

DevOps/SRE takımı için credential vault uygulaması. KeePassXC'ye alternatif: merkezi, canlı sync'li, MFA destekli, E2E şifreli.

**Kapsam:**
- Server: Kubernetes üzerinde Go tabanlı REST + WebSocket API
- Web Admin UI: React + Vite + TypeScript
- Client: Tauri 2.x (Rust) — Windows + macOS native, offline cache
- Auth: Argon2id + TOTP + WebAuthn/FIDO2 + Trusted Device + mTLS client cert
- **3-katmanlı RBAC:** Global rol (admin/write/read) + Klasör ACL (grup dahil) + Item-level share
- **Gruplar:** `groups` + `group_members` + `folder_group_permissions`
- **Dinamik veri modeli:** `item_types` + `field_definitions` + `item_relationships`
- **Versiyonlama:** `item_field_versions` — max 10 versiyon, FIFO
- **Etiketler + Favoriler:** `tags`, `item_tags`, `user_favorites`
- **Bildirimler:** `notifications` + in-app WS push + email + Slack/Teams webhook
- **Credential expiry:** nightly scanner + health score (0-100)
- **Break-glass:** `users.is_break_glass` — acil erişim, tüm adminlere anlık uyarı
- **One-time share:** `item_share_links` — E2E, link_key URL fragment'ta
- **External secret backends:** HashiCorp Vault proxy + dinamik credential
- **Pipeline/Lifecycle:** ReactFlow görselleştirme + swimlane + PNG/SVG export
- **İlişki haritası:** `item_relationships` graph + D3 render
- **Linked entries:** `item_links` — mirror/reference field propagation
- **Arama:** pg_trgm trigram fuzzy + HMAC blind index
- **Şablonlar:** kullanıcı tanımlı + 11 quickstart
- **Duplicate detection:** HMAC blind index ile aynı isim uyarısı
- **Bulk export:** Şifreli ZIP (E2E, disaster recovery)
- **Import:** CSV + KeePass .kdbx
- **MCP server:** `cmd/mcp/` — Claude Code ve LLM agent'larına read-only vault erişimi
- **AI önerileri:** tag + ilişki önerisi (LLM, PII korumalı)
- **CLI:** `cli/` — `ironstock` komutu, multi-arch Go binary
- **Ekosistem:** Ansible dynamic inventory, Prometheus AlertRules, SCIM 2.0, Splunk/Elastic forwarding, Secret scanning

## Tech Stack

| Katman | Teknoloji |
|--------|-----------|
| Backend | Go 1.23 |
| Client | Tauri 2.x (Rust) + Vite frontend |
| Admin web | React 18 + Vite + TypeScript + Tailwind 4 + shadcn/ui |
| State | Zustand (auth/ui) + TanStack Query (server state) |
| Veritabanı | PostgreSQL 16 + goose migration |
| Şifreleme | AES-256-GCM (envelope) + X25519 (key wrap) + Argon2id (KEK) |
| Auth | JWT (15dk access + 7g refresh) + TOTP + WebAuthn + mTLS |
| Realtime | WebSocket + Redis pub/sub (horizontal scale) |
| Storage | MinIO (attachments) |
| Dev stack | Docker Compose |
| Container | Multi-stage Dockerfile → GHCR (multi-arch amd64+arm64) |
| Deploy | Raw k8s YAML + ArgoCD GitOps + Sealed Secrets |
| CI | GitHub Actions (server + web + e2e + security scan) |

## Güvenlik Modeli (Hibrit)

- **Metadata** (item isim, IP, hostname): server-side envelope encryption — master key KMS'te, per-item DEK.
- **Secret field'lar** (parola, private key, token): client-side E2E — Argon2id KEK ile şifrelenir. **Server plaintext asla görmez.**
- **Paylaşılan item'lar**: per-item DEK, yetkili kullanıcıların public key'leri (X25519) ile wrap edilir.
- **Vault-backed item'lar**: path referansı tutar, secret DB'ye yazılmaz. Erişimde Vault proxy. ADR-0007.
- **LLM/AI**: item field değerleri (secret veya değil) LLM'e **asla gönderilmez** — sadece name+description+tag+type.
- **Audit log**: server-side plaintext (uyumluluk için).

Detay: `docs/adr/0002-security-model.md` + `docs/adr/0004-encryption-details.md`

## Dizin Yapısı

```
IronStock/
├── server/                  # Go backend (cmd/, internal/, migrations/)
│   └── migrations/          # En son: 00059_secret_fingerprints.sql
├── client/                  # Tauri app (src-tauri/ + src/)
├── web/                     # Admin UI (React + Vite)
├── cli/                     # ironstock CLI (Go, ayrı modül)
├── e2e/                     # Playwright E2E testleri
├── shared/                  # OpenAPI spec + generated types
├── deploy/                  # k8s YAML + docker-compose
├── scripts/                 # check-tracking-files.sh vb.
├── docs/                    # ADR'ler + diyagramlar
│   └── adr/                 # 0001–0012 (0012: geliştirme tracking disiplini)
├── .github/workflows/       # CI: ci.yml + security.yml + e2e.yml
├── .github/PULL_REQUEST_TEMPLATE.md
├── .pre-commit-config.yaml  # gofmt + golangci-lint + eslint + gitleaks + tracking check
├── CLAUDE.md                # Bu dosya (her session otomatik yüklenir)
├── PROGRESS.md              # Güncel durum + tamamlanan PR detayları
├── RULES.md                 # Geliştirme kuralları (tracking zorunluluğu dahil)
├── TODO.md                  # Aktif + tamamlanan task'lar
└── Makefile                 # Ortak komutlar
```

## Güncel Durum (2026-05-24)

- **Tamamlanan:** 24/27 PR (%89) — Faz 6–10 tam, Faz 11 kısmi (PR-PROD1/2/3/4/5 done)
- **Aktif:** PR-PROD6 (Docs)
- **Kalan:** PR-PROD6 (Docs), PR-PROD7 (DR+Backup), PR-TF (ayrı repo), PR-BROWSER (ayrı dizin)
- **Migration:** En son `00060_pg_stat_statements.sql` → yeni migration eklerken `00061`'den başla

## Her Session'da Yapılacaklar

1. `PROGRESS.md` oku — aktif faz, son PR detayları, güncel durum.
2. `TODO.md` oku — sıradaki task, kalan PR'lar.
3. `RULES.md` dikkate al — kod/commit/test/tracking kuralları.
4. **İş bitince:** `PROGRESS.md` + `TODO.md` aynı commit'e dahil et (pre-commit hook da zorlar).

## Kritik Kurallar (Özet)

Tam liste: `RULES.md` + `docs/adr/0012-development-tracking-discipline.md`

- Secret field (parola, token, private key) asla plaintext log'lanmaz veya repo'ya commit edilmez.
- Test yazılmadan public API merge edilmez.
- Her mimari karar `docs/adr/NNNN-*.md` formatında ADR olarak yazılır.
- **Her kod commit'inde `PROGRESS.md` + `TODO.md` aynı commit'e dahil edilir** (pre-commit hook zorlar; `SKIP_TRACKING_CHECK=1` meşru bypass).
- Conventional Commits formatı zorunlu (`feat/fix/chore/docs/refactor`).
- `ClaimsFromContext(ctx)` kullan — `claimsFromCtx` diye bir şey yok.
- `auth.ResolveItemPermission(ctx, db, userID, itemID)` — doğru permission resolver.
- LLM'e item field değerleri (secret veya değil) **asla gönderilmez**.
- Password reset E2E private key'i kaybettirir → amber uyarı UI'da zorunlu.
- MCP server: sadece read-only tool'lar (mutation yok).

## Yeni Geliştirici Kurulum

```bash
git clone https://github.com/GameOfAI/IronStock.git
cd IronStock
pip install pre-commit && pre-commit install   # tracking hook + gitleaks + linter
cd server && go mod download
cd ../web && npm install
```
