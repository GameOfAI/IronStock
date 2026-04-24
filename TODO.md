# Yapılacaklar

Son güncelleme: 2026-04-24

TodoWrite ile senkronize çalışır — aktif session'daki live task listesi TodoWrite'tadır, bu dosya kalıcı referanstır.

İşaretler: `[ ]` TODO · `[~]` devam ediyor · `[x]` tamamlandı · `[!]` bloke

---

## Aktif: Faz 0 — Temel kurulum (VERIFY bekliyor)

Kod iskeleti tamamlandı. Kullanıcı smoke test'i lokal makinede çalıştıracak.

- [x] Monorepo dizin yapısı (server/, client/, web/, shared/, deploy/, docs/, .github/workflows/)
- [x] Root config dosyaları: `.gitignore`, `.editorconfig`, `README.md`, `LICENSE`, `Makefile`, `.env.example`, `go.work`
- [x] Go modülü + workspace (`server/go.mod`, `cmd/api/main.go` healthz, `internal/` doc.go iskeleti)
- [x] Docker Compose dev stack (Postgres 16, Adminer, Mailhog)
- [x] `golangci-lint` config + pre-commit hook (`.pre-commit-config.yaml`)
- [x] GitHub Actions CI iskeleti (server + pre-commit job'ları)
- [x] İlk ADR'ler: `0001-tech-stack.md`, `0002-security-model.md`, `0003-repo-layout.md`
- [x] Web (admin UI) iskeleti: Vite + React + TypeScript + ESLint + Prettier
- [x] Tauri client iskeleti: Cargo.toml + tauri.conf.json + main.rs/lib.rs + Vite frontend
- [x] Faz 0 smoke test kılavuzu: `docs/smoke-test.md`

### User aksiyonu (Faz 0 kapatmak için)

- [!] Git repo başlat: `git init && git add . && git commit -m "chore: initial scaffold"`
- [!] `docs/smoke-test.md`'deki adımları çalıştır (lokal tool'lar kurulu olmalı)
- [!] GitHub'a push et, CI yeşil olsun
- [!] Branch protection kurallarını `main` için ayarla (bkz. `.github/workflows/README.md`)

---

## Sıradaki: Faz 1 — Veri modeli + kripto tasarımı (2-3 gün)

- [ ] ER diyagram — `docs/diagrams/er.mmd` (Mermaid)
  - Tablolar: `users`, `roles`, `user_roles`, `folders`, `items`, `item_fields`, `item_shares`, `audit_log`, `sessions`, `totp_secrets`, `user_keypairs`
- [ ] Şifreleme modeli ADR — `docs/adr/0004-encryption-details.md`
  - Envelope encryption: master key → per-item DEK
  - Client-side E2E: Argon2id params, key derivation, X25519 wrap
  - Key rotation stratejisi
- [ ] Migration tool seçimi (goose vs atlas) ve adoption
- [ ] İlk migration setleri: users, roles, sessions, audit_log
- [ ] `shared/api/openapi.yaml` — v1 endpoint taslağı
- [ ] Code generation pipeline (sqlc for Go + openapi-typescript for TS)

## Faz 2 — Server MVP (~1 hafta)

- [ ] HTTP server iskeleti (chi router) + middleware chain (logging, recovery, request-id, CORS)
- [ ] DB katmanı (pgx pool + sqlc generated queries)
- [ ] Argon2id password hashing + user registration endpoint
- [ ] TOTP enroll (QR code) + verify endpoint
- [ ] JWT session (access 15dk + refresh 7g) + auth middleware
- [ ] RBAC middleware (read / write role check)
- [ ] Folder CRUD API (tree yapısı, parent_id)
- [ ] Item CRUD API (metadata envelope encrypted)
- [ ] WebSocket hub (pub/sub change events — item created/updated/deleted)
- [ ] Audit log yazıcı (middleware + explicit call)
- [ ] Rate limiting (login, TOTP verify)
- [ ] Unit + integration test (testcontainers-go)
- [ ] OpenAPI docs serve (`/docs`)

## Faz 3 — Admin Web UI (~4-5 gün)

- [ ] Auth akışı (login + MFA form)
- [ ] Session yönetimi (refresh token rotation)
- [ ] User/role yönetim sayfası (CRUD)
- [ ] Envanter ağaç + tablo view (KeePassXC tarzı layout)
- [ ] Folder oluştur/düzenle/sil modali
- [ ] Item edit formu (field tipleri: text, password, url+cred, hardware spec)
- [ ] WebSocket entegrasyonu (live update)
- [ ] Audit log görüntüleyici
- [ ] Responsive layout + dark mode

## Faz 4 — Client MVP Tauri (~1-2 hafta)

- [ ] Tauri project config Windows + macOS target
- [ ] Server connection config ekranı (URL + TLS cert trust)
- [ ] Auth akışı (login + MFA + master key derive Argon2id)
- [ ] Master key in-memory vault (uygulama kapanınca silinir)
- [ ] Envanter UI (ağaç + detay panel, KeePassXC görseli)
- [ ] WebSocket live sync
- [ ] Şifrelenmiş offline cache (SQLite + SQLCipher, local DEK master key'den derive)
- [ ] Client-side E2E şifreleme (secret field'lar)
- [ ] Reconnect logic + offline mode indicator
- [ ] Copy-to-clipboard auto-clear (30sn)
- [ ] Auto-lock after idle (5dk default, configurable)

## Faz 5 — Production hardening (~1 hafta)

- [ ] Helm chart (server + postgres dependency)
- [ ] External Secrets Operator entegrasyonu (veya Sealed Secrets)
- [ ] TLS config + ingress (cert-manager)
- [ ] Prometheus metrics (custom + runtime)
- [ ] Grafana dashboard template
- [ ] Structured logging (slog) + log aggregation uyumu
- [ ] Backup/restore prosedürü + cron
- [ ] Win MSI packaging + code signing
- [ ] Mac .dmg packaging + notarization
- [ ] Production readiness checklist
- [ ] v1.0.0 release

---

## Parking Lot (ileride değerlendirilecek)

- Mobile client (iOS / Android)
- Browser extension (kayıt otomatik doldurma)
- SSO entegrasyonu (OIDC — Azure AD, Okta)
- Hardware key desteği (WebAuthn / FIDO2)
- Paylaşım linkleri (geçici, token-based, TTL'li erişim)
- Item versioning / change history görüntüleme
- Bulk import/export (CSV, KeePassXC .kdbx import)
- CLI client (grep + find envanterinde)
- Terraform provider
- Telemetri (opsiyonel, self-hosted, anon kullanım istatistikleri)

---

## Kararlaştırılacak Açık Noktalar

- [ ] Frontend state management: Zustand mi Redux Toolkit mi? → Faz 3'te karar
- [ ] OpenAPI generator'dan Go client de üretilsin mi (integration test için)? → Faz 1'de karar
- [ ] Client auto-update mekanizması: Tauri built-in updater mı self-hosted mı? → Faz 4'te karar
- [ ] Postgres HA / replication stratejisi (tek master + read replica?) → Faz 5'te karar
