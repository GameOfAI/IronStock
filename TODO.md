# Yapılacaklar

Son güncelleme: 2026-04-25

TodoWrite ile senkronize çalışır — aktif session'daki live task listesi TodoWrite'tadır, bu dosya kalıcı referanstır.

İşaretler: `[ ]` TODO · `[~]` devam ediyor · `[x]` tamamlandı · `[!]` bloke / user aksiyonu bekliyor · 🚨 kritik

---

## ~~🚨 KRİTİK — Secret Leak~~ ✅ ÇÖZÜLDÜ (2026-04-25)

`deploy/k8s/secret.yaml` plaintext leak'i tamamen kapatıldı. ADR-0008'e ayrıntılı yazılı.

- [x] `ENVANTER_MASTER_KEY` rotate
- [x] `ENVANTER_JWT_SECRET` rotate
- [x] `secret.yaml`'ı `.gitignore`'a ekle
- [x] `secret.yaml.example` placeholder ile yer tutucu commit
- [x] Mac cluster'da `kubectl create secret` ile uygulandı
- [x] Git history'den eski secret'ları purge (BFG, 2026-04-25)
- [ ] **Sealed Secrets / External Secrets Operator adoption** → Faz 5'in part'ı

---

## Aktif: Faz 2 — Server MVP

### ✅ PR-1: Foundation (config + logging) — MERGED `cb87259`

- [x] `internal/config` — env loader + 9 unit test
- [x] `internal/logging` — slog + secret redaction + 8 unit test
- [x] `cmd/api/main.go` refactor (config + logger wire)
- [x] CI yeşil + merge → main'de canlı
- [x] **DB migration init container** — Mac (paralel, ADR-0008)

### ✅ PR-2: DB layer + chi router — `feat/server-db-chi` (REVIEW/MERGE BEKLIYOR)

**Durum:** Branch push edildi, lokal CI yeşil (28 test, gofmt OK, build OK). GitHub'da PR aç + CI yeşilini bekle + squash merge.

- [x] Go 1.26.2 kuruldu (Win)
- [x] Go deps: `github.com/go-chi/chi/v5 v5.2.5`, `github.com/jackc/pgx/v5 v5.9.2`
- [x] `go.mod` + `go.sum` (`go 1.25.0` directive — pgx v5.9.2 min)
- [x] `go.work` go directive bumped to 1.25.0
- [x] `internal/db` — pgxpool wrapper + Config validation + 5 unit test
- [x] `internal/httpapi/router.go` — chi router + 6 middleware (RequestID, echoRequestIDHeader, RealIP, slogLogger, Recoverer, Timeout)
- [x] `internal/httpapi/health.go` — /healthz (alive), /readyz (DB ping 2sn timeout)
- [x] `cmd/api/main.go` — DB pool + chi router wire
- [x] httpapi router unit testler (httptest, fakeDB) — 6 test
- [x] CI matrix: Go 1.22 → stable (pgx min 1.25)

### ✅ PR-3: Migrations + Integration Test — `feat/server-migrations` (REVIEW BEKLIYOR)

- [x] 12 migration: master_keys, user_keypairs, totp_secrets, recovery_codes, item_types(+8 seed), field_definitions(+30 seed), folders, folder_permissions, items(external_source), item_fields, item_shares, item_relationships
- [x] testcontainers-go integration test (up/down/up + seed validation)
- [x] CI `server-integration` job (Go 1.23, Docker)
- [x] Makefile `test-integration` target
- [x] sqlc queries (minimal): field_definitions + item_types
- [x] Lokal validation: build/test/lint clean

### 🔜 PR-4: Crypto package — `feat/server-crypto` (SIRADA — PR-3 merge sonrası)

- [ ] `00006_user_keypairs.sql`
- [ ] `00007_totp_secrets.sql`
- [ ] `00008_recovery_codes.sql`
- [ ] `00009_master_keys.sql`
- [ ] `00010_item_types.sql` + seed
- [ ] `00011_field_definitions.sql` + seed
- [ ] `00012_folders.sql` + `00013_folder_permissions.sql`
- [ ] `00014_items.sql` + `00015_item_fields.sql` + `00016_item_shares.sql`
- [ ] `00017_item_relationships.sql`
- [ ] sqlc query genişletmeleri

### PR-4: Crypto package — `feat/server-crypto`

## Tamamlanan: Faz 0 — Temel kurulum (VERIFY bekliyor)

- [x] Monorepo dizin yapısı
- [x] Root config dosyaları
- [x] Go modülü + workspace
- [x] Docker Compose dev stack (Postgres 16 + Adminer + Mailhog)
- [x] `golangci-lint` + pre-commit hook
- [x] GitHub Actions CI iskeleti
- [x] İlk 3 ADR (tech-stack, security-model, repo-layout)
- [x] Web iskeleti (Vite + React + TS)
- [x] Tauri client iskeleti
- [x] Smoke test kılavuzu: `docs/smoke-test.md`

### User aksiyonu (Faz 0)

- [!] `docs/smoke-test.md`'deki adımları lokal makinede çalıştır
- [!] (Opsiyonel) GitHub'a push et, CI yeşil olsun
- [!] (Opsiyonel) Branch protection kurallarını `main` için ayarla

## Tamamlanan: Faz 1 — Veri modeli + kripto tasarımı

- [x] ER diyagram — `docs/diagrams/er.mmd` (11 tablo)
- [x] ADR-0004: şifreleme detayları (AES-GCM, Argon2id, X25519, HMAC search)
- [x] ADR-0005: migration tool = goose
- [x] Auth akış dokümantasyonu — `docs/auth-flow.md` (9 senaryo, Mermaid sequence)
- [x] 5 migration: `00001_init_extensions`, `00002_users`, `00003_roles`, `00004_sessions`, `00005_audit_log`
- [x] OpenAPI 3.1 spec — `shared/api/openapi.yaml` (health + 10 auth endpoint)
- [x] Code gen config: `sqlc.yaml`, `oapi-codegen.yaml`, Makefile `gen` hedefleri
- [x] İlk sqlc query'leri: users, sessions, roles, audit_log

### User aksiyonu (Faz 1)

- [!] `make tools-install` — sqlc, oapi-codegen, goose, golangci-lint kur
- [!] `make up` → Postgres dev stack
- [!] `make migrate-up` → schema'yı uygula
- [!] Adminer'da (http://localhost:8081) şema'yı gözden geçir
- [!] `make gen` → generated code üret (commit'le)
- [!] `make lint-openapi` (opsiyonel) — OpenAPI spec Redocly ile validate

---

## Sıradaki: Faz 2 — Server MVP (~1 hafta)

### Altyapı
- [ ] HTTP server (chi router) + middleware: logging (slog), recovery, request-id, CORS
- [ ] Config loader (`internal/config`) — env → struct + validation
- [ ] DB katmanı (pgx v5 pool + sqlc generated queries), connection health check
- [ ] Crypto package (`internal/crypto`): envelope encrypt/decrypt, AAD helpers, known-answer tests

### Ek migration'lar (Faz 2 kapsamı — 12 yeni dosya)
- [ ] `00006_user_keypairs.sql`
- [ ] `00007_totp_secrets.sql`
- [ ] `00008_recovery_codes.sql`
- [ ] `00009_master_keys.sql`
- [ ] `00010_item_types.sql` + seed (8 tip: server, url, database, ssh_key, certificate, cloud_credential, note, generic)
- [ ] `00011_field_definitions.sql` + seed (~20 field tanımı, environment + criticality enum dahil)
- [ ] `00012_folders.sql`
- [ ] `00013_folder_permissions.sql`
- [ ] `00014_items.sql` (**`external_source jsonb` kolonu dahil**, Vault için hazır)
- [ ] `00015_item_fields.sql` (**`field_definition_id` FK**, `value_enc` nullable, `is_secret` yok)
- [ ] `00016_item_shares.sql`
- [ ] `00017_item_relationships.sql` (5 relationship_type CHECK)

### Auth
- [ ] Argon2id password hash/verify
- [ ] TOTP (RFC 6238) enroll + verify
- [ ] JWT access (15dk) + opaque refresh (7g, rotating) + auth middleware
- [ ] Session binding (UA/IP flag) + token reuse detection
- [ ] Rate limit middleware (login, TOTP verify, refresh, recover)
- [ ] Account lockout (10 fail → 30dk lock)
- [ ] **RBAC middleware — 3 katmanlı effective permission:**
  1. admin role check (bypass all)
  2. item_shares check
  3. folder_permissions ancestor walk (inherit_to_children)
- [ ] Item relationships API (create/list/filter by type, jump server traversal)
- [ ] field_definitions admin API (list/create, sadece admin mutation)
- [ ] item_types admin API (list/create, sadece admin mutation)

### Endpoint implementasyonu (oapi-codegen handler interface)
- [ ] `/healthz`, `/readyz`
- [ ] `/auth/register`, `/auth/totp/init`, `/auth/totp/verify`
- [ ] `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`
- [ ] `/auth/change-password`, `/auth/recover/init`, `/auth/recover/complete`
- [ ] (Faz 2 scope): Folder CRUD, Item CRUD (metadata envelope + secret client-provided), Item share
- [ ] WebSocket hub (`/ws`): pub/sub change events

### Audit + test
- [ ] Audit log yazıcı (middleware + explicit call helper)
- [ ] Unit test (crypto, auth logic, RBAC)
- [ ] Integration test (testcontainers-go + gerçek Postgres + migration up/down/up)
- [ ] OpenAPI docs serve (`/docs` — embedded spec)
- [ ] CI: `server-integration` job

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
- [ ] Auto-lock after idle (10dk default, 5/10/15/30 configurable)

## Faz 5 — Production hardening (~1 hafta)

### k8s / Deploy

**Mac M4 tarafında erken yapılan (ADR-0008):**
- [x] Server + Web Dockerfile (multi-stage, scratch + nginx)
- [x] GHCR pipeline (multi-arch amd64+arm64)
- [x] Raw k8s manifests (namespace, configmap, secret, postgres+PVC, api, web, adminer, mailhog)
- [x] ArgoCD Application (auto-sync, prune, self-heal)

**Hâlâ yapılacak:**
- [!] **🚨 secret.yaml plaintext fix** (yukarıda kritik bölüm)
- [ ] Sealed Secrets veya External Secrets Operator adoption
- [ ] Image versioning — `:latest` yerine git SHA / semver tag
- [ ] Resource limits + HPA + PodDisruptionBudget
- [ ] Pod Security Standards (runAsNonRoot, readOnlyRootFilesystem, drop caps)
- [ ] NetworkPolicy (pod-to-pod traffic kısıtlama)
- [ ] TLS config + Ingress (cert-manager + Let's Encrypt) — NodePort retire
- [ ] Helm chart migration (opsiyonel — raw YAML yeterli olursa atlanır)
- [ ] DB migration init container (api Deployment) — PR-2 ile koordineli
- [ ] Managed DB değerlendirmesi (Cloud SQL / RDS / on-prem HA cluster)
- [ ] Distroless image (server scratch yerine `gcr.io/distroless/static-debian12`)

### Observability
- [ ] Prometheus metrics (custom + runtime)
- [ ] Grafana dashboard template
- [ ] Structured logging (slog) + log aggregation uyumu

### Ops
- [ ] Backup/restore prosedürü + cron
- [ ] KMS entegrasyonu (master_keys rotation batch job)

### External Secret Backends (ADR-0007)
- [ ] `server/internal/vault` — HTTP client + k8s AppRole auth
- [ ] Item detail endpoint genişletme: `external_source` doluysa Vault passthrough
- [ ] Audit log integration — her Vault fetch `item.external_fetch` olarak log'lanır
- [ ] Web + client UI: "Vault-backed item oluştur" formu + key_mapping editor
- [ ] Bonus: Dynamic secrets flow (`POST /items/:id/dynamic-cred` → Vault'tan 15dk'lık cred)

### Packaging
- [ ] Win MSI packaging + code signing
- [ ] Mac .dmg packaging + notarization
- [ ] Tauri auto-updater (built-in vs self-hosted — Faz 4'te karar verilir)

### Release
- [ ] Production readiness checklist
- [ ] v1.0.0 release

---

## Parking Lot (ileride değerlendirilecek)

### Auth & Kimlik
- OIDC SSO (Azure AD / Okta / Keycloak) — Vault ile ortak kimlik
- Hardware key desteği (WebAuthn / FIDO2)

### External Secrets
- Vault auto-discovery polling (watched paths — pattern farkı nedeniyle MVP'den çıkarıldı)
- AWS Secrets Manager support (aynı `external_source` mekanizması)
- Azure Key Vault support
- GCP Secret Manager support

### Yetkilendirme
- Groups / teams (direkt user-permission → group-permission; büyük takımlar için)
- Deny override rules for `folder_permissions` (şu an sadece grant)

### Platform
- Mobile client (iOS / Android) — Tauri 2 mobile
- Browser extension (kayıt otomatik doldurma)
- CLI client (grep + find envanterinde)
- Terraform provider

### Feature
- Paylaşım linkleri (geçici, token-based, TTL'li erişim)
- Item versioning / change history görüntüleme
- Bulk import/export (CSV, KeePassXC .kdbx import)
- Telemetri (opsiyonel, self-hosted, anon kullanım istatistikleri)
- Searchable encryption — full-text arama için bigram/trigram blind index

---

## Kararlaştırılacak Açık Noktalar

- [ ] Frontend state management: Zustand mi Redux Toolkit mi? → Faz 3'te karar
- [x] ~~OpenAPI generator'dan Go client de üretilsin mi?~~ → **Karar: sadece server tarafı oapi-codegen**. Integration test için doğrudan `net/http` veya `resty` kullanılır (Faz 2'de kesinleşir).
- [ ] Client auto-update mekanizması: Tauri built-in updater mı self-hosted mı? → Faz 4'te karar
- [ ] Postgres HA / replication stratejisi (tek master + read replica?) → Faz 5'te karar
- [ ] sqlc override'larda `inet` için `netip.Addr` mı `net.IP` mi? → Faz 2 implementation'da netleşir

## Tamamlanan Kararlar

### Cross-machine deploy iterasyonu (2026-04-25, Mac M4)
- **Container images:** Multi-stage (server: scratch, web: nginx)
- **Registry:** GHCR (multi-arch amd64+arm64)
- **K8s deploy:** Raw YAML manifests (Helm yerine, başlangıç için)
- **GitOps:** ArgoCD Application (auto-sync, prune, self-heal)
- **CI:** docker build/push job, push to main only
- ADR-0008'de detaylı

### İlk iterasyon
- UUID v7 client-üretimli (AAD pending problemi için)
- MFA zorunlu (login'de TOTP, unlock'ta sadece master password)
- Recovery code → yeni keypair (solo item kaybı kabul, prominent UI uyarı)
- Auto-lock default 10dk, configurable 5/10/15/30
- Searchable encryption HMAC-SHA256 hash (frequency leak kabul)
- Session binding = flag not block; token reuse → tüm session'lar revoke
- Migration tool: goose
- Atlas yerine SQL-first — review disiplini için

### Genişleme iterasyonu (UX + RBAC + Vault)
- **item_types:** Ayrı tablo (enum değil) — admin yeni tip ekleyebilir. 8 seed tip.
- **field_definitions:** Merkezi field sözlüğü, hostname/host_name drift engellendi. `is_secret` tanımın parçası. Enum desteği (`allowed_values jsonb`).
- **item_relationships:** 5 tip (hosted_on, accessed_via, part_of, related_to, depends_on). Jump server zinciri `accessed_via` ile.
- **3-katmanlı RBAC:** Global rol (admin/write/read) + folder_permissions (inherit_to_children) + item_shares.
- **Vault entegrasyonu:** Proxy modeli — DB'ye yazmaz, passthrough. `items.external_source jsonb` schema hazırlığı Faz 2, implementation Faz 5.
- **Vault auth:** k8s Service Account → Vault AppRole (MVP). OIDC SSO parking lot.
- **Vault linking:** Manuel-only. Auto-discovery parking lot.
- **Environment/criticality:** Enum field_definition seed'i (prod/stage/test/dev/lab ve critical/high/medium/low).
- **Organizational convention:** Proje × ortam folder yapısı tavsiye edilir, zorunlu değil.
