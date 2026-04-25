# İlerleyiş

Son güncelleme: 2026-04-25

## Mevcut Durum

- **Aktif Faz:** Faz 2 — Server MVP (PR-1 ✅ merged; PR-2 hazır, review/merge bekliyor)
- **Tamamlanan Faz:** Faz 0 + Faz 1
- **Çift makine workflow:** Win = kod (PR akışı), Mac M4 = container/deploy (main direct, ADR-0008)
- **Bloker:** Yok (secret rotation + BFG history purge tamamlandı 2026-04-25)
- **Mac canlı k8s test:** Tüm pod'lar 1/1 Running, init container ile migration auto-apply, `/healthz` 200 OK
- **Bir sonraki adım:** PR-2 review/merge → PR-3 (Faz 2 ek migration'lar: keypairs/totp/recovery/master_keys/items/...) → PR-4 (crypto package)

## Faz Durumu

| Faz | Durum | Başlangıç | Bitiş | Not |
|-----|-------|-----------|-------|-----|
| 0 — Temel kurulum | VERIFY | 2026-04-24 | 2026-04-24 | Kod yazıldı, lokal smoke test user tarafında |
| 1 — Veri modeli + kripto tasarımı | DONE | 2026-04-24 | 2026-04-24 | ER (17 tablo) + ADR 0004/0005/0006/0007 + auth-flow + 5 migration + OpenAPI + code gen |
| 2 — Server MVP | ACTIVE | 2026-04-24 | — | PR-1 (config+logging) ✅ merged `cb87259`; PR-2 sırada (DB+chi). Mac'te canlı çalışıyor (init container ile migrations otomatik) |
| 3 — Admin Web UI | TODO | — | — | Login + user mgmt + ağaç view |
| 4 — Client MVP (Tauri) | TODO | — | — | Win+Mac, live sync, offline cache, E2E |
| 5 — Production hardening | PARTIAL | 2026-04-25 | — | Container + GHCR + k8s + ArgoCD + DB migration init container + native cross-compile multi-arch + secret rotation tamam. Sealed Secrets, Helm, observability, Ingress+TLS hâlâ TODO |

Durumlar: `DONE` tamamlandı · `ACTIVE` devam ediyor · `PARTIAL` parçalı tamamlandı · `VERIFY` doğrulama bekliyor · `BLOCKED` bloke · `TODO` beklemede

## Faz 0 Task İlerlemesi

- [x] Monorepo dizin yapısı
- [x] Root config dosyaları (.gitignore, .editorconfig, README, LICENSE, Makefile, .env.example, go.work)
- [x] Go modülü + workspace (server/go.mod + cmd/api/main.go healthz + internal/ doc.go iskeleti)
- [x] Docker Compose dev stack (Postgres 16 + Adminer + Mailhog)
- [x] golangci-lint config (.golangci.yml) + pre-commit hook (.pre-commit-config.yaml, gitleaks dahil)
- [x] GitHub Actions CI iskeleti (server job + pre-commit job)
- [x] İlk 3 ADR (tech-stack, security-model, repo-layout) + docs/adr/README
- [x] Web (admin) iskeleti (Vite + React + TS + ESLint + Prettier)
- [x] Tauri client iskeleti (Rust src-tauri + Vite + React + TS)
- [x] Faz 0 smoke test kılavuzu (docs/smoke-test.md)
- [ ] **User aksiyonu:** Smoke test'in lokalde çalıştırılması ve CI'ın ilk push'ta yeşile gelmesi

## Faz 1 Task İlerlemesi

- [x] ER diyagram (Mermaid) — `docs/diagrams/er.mmd` (11 tablo: auth + inventory + audit + keys)
- [x] Şifreleme detayları ADR — `docs/adr/0004-encryption-details.md` (AES-256-GCM + Argon2id + X25519 + HMAC search)
- [x] Migration tool ADR — `docs/adr/0005-migration-tool.md` (goose seçimi)
- [x] Auth flow dokümantasyonu — `docs/auth-flow.md` (9 senaryo Mermaid sequence diagram)
- [x] Tasarım review — 6 karar netleşti (UUID v7, MFA mandatory, recovery=new keypair, auto-lock 10dk, searchable enc kabul, session binding=flag)
- [x] İlk 5 migration: `00001_init_extensions` + `00002_users` + `00003_roles` + `00004_sessions` + `00005_audit_log`
- [x] OpenAPI v1 taslak — `shared/api/openapi.yaml` (health + 10 auth endpoint)
- [x] Code gen pipeline: `server/sqlc.yaml` + `server/oapi-codegen.yaml` + Makefile `gen`/`gen-*` hedefleri
- [x] sqlc query örnekleri: `server/queries/{users,sessions,roles,audit_log}.sql`
- [ ] **User aksiyonu:** Lokal tool'ları kur (`make tools-install` — sqlc, oapi-codegen, goose, golangci-lint), `make gen` + `make migrate-up` çalıştır, schema'yı Adminer'da doğrula.

## Günlük

### 2026-04-25 (Win) — Faz 2 PR-2: DB layer + chi router

**Branch:** `feat/server-db-chi` — review/merge bekliyor.

**Önkoşul:** Win'de Go 1.26.2 kuruldu (`C:\Program Files\Go\`).

**İçerik:**

- **`internal/db`** (yeni) — pgx v5 `pgxpool` wrapper:
  - `Config` struct: URL, MaxConns, MinConns, HealthCheckInterval
  - `Validate()`: URL boş, min<0, max<min, üçü için error mesajları
  - `New(ctx, cfg)`: parse → pool yarat → ilk Ping (5sn timeout) → fail fast davranışı
  - 5 unit test (config validation; live DB testleri PR-3+'da testcontainers-go ile)

- **`internal/httpapi`** (genişletildi) — chi router + middleware stack + handlers:
  - `NewRouter(Deps)` chi router döner; 6 middleware sırası: RequestID → echoRequestIDHeader (yeni helper) → RealIP → slogRequestLogger → Recoverer → Timeout(30s)
  - `slogRequestLogger`: her request için tek satır JSON log; **/healthz ve /readyz log spam'i için filtrelenir** (k8s probe'ları sürekli çağırır)
  - `DBPinger` interface — pgxpool.Pool satisfies; testlerde fake injection
  - `/healthz`: liveness probe, sadece process alive (200 OK)
  - `/readyz`: readiness probe, **2sn timeout ile DB Ping**; fail → 503 + log warn
  - 6 test: /healthz 200, /readyz DB OK 200, /readyz DB down 503, X-Request-Id header echo, 404 unknown path, 405 POST /healthz

- **`cmd/api/main.go`** (refactor) — config + logging + db pool + chi router birlikte wire edildi. Graceful shutdown korundu.

- **`server/go.mod` + `go.sum`** — yeni deps: `github.com/go-chi/chi/v5 v5.2.5`, `github.com/jackc/pgx/v5 v5.9.2` + indirect (puddle, pgpassfile, pgservicefile, x/sync, x/text). `go 1.25.0` directive (pgx v5.9.2 minimum).

- **`go.work`** — `go 1.22` → `go 1.25.0` (workspace go directive must be ≥ module).

- **`.github/workflows/ci.yml`** — Go matrix `1.22` → `stable` (setup-go'nun son stable Go'su; pgx 1.25+ gerekli).

**Lokal doğrulama (Win, Go 1.26.2):**
- `go build ./...` ✅
- `go vet ./...` ✅
- `go test ./...` ✅ — 28 test, 0 fail (config 9 + db 5 + httpapi 6 + logging 8)
- `gofmt -l .` boş (CRLF→LF auto-fix sonrası)
- Binary boyut: 13.1 MB (server/cmd/api)

**Bilinçli kapsam dışı (PR-3+'a bırakıldı):**
- testcontainers-go ile DB integration test (gerçek migration up/down)
- Auth endpoints (Argon2id + TOTP + JWT)
- Faz 2 ek migration'lar (00006-00017)
- Crypto package (`internal/crypto`)
- WebSocket hub

### 2026-04-25 (Win catch-up) — Tracking sync sonrası BFG history purge

Mac M4'te yapılan kapsamlı çalışmalardan sonra Win local repo'su `git reset --hard origin/main` ile remote'a hizalandı (BFG history purge'u sonrası tüm commit hash'leri yeniden yazılmıştı: `b35a46c → 21bd3df → 242cf40 → cb87259`, vs.).

**Mac'in tamamladıkları (özet):**
- PR-1 merge (`cb87259`)
- CI optimizasyonu: 1+ saat → 5dk
- Secret rotation + history purge (`daa48d0` + BFG)
- DB migration init container (`9ea420b`) — `goose` binary embed + `/migrations` copy + initContainers entry
- Server Dockerfile native cross-compile (`a89ac83` + `3bbb077` + `89be3c2`) — QEMU yok, ~8dk multi-arch
- Tag'ler: `v0.1.0-dev`, `v0.1.1-dev`
- Cluster doğrulama: tüm pod 1/1 Running, /healthz 200 OK

**Win catch-up commit'i (bu):**
- PROGRESS.md "Mevcut Durum" + Faz Durumu tablosu güncellendi (PR-1 merged, secret bloker resolved, Faz 5 PARTIAL detayı genişletildi)
- TODO.md "Aktif" bölümü ve kritik secret rotation [x] işaretleri tamamlandı
- ADR-0008 "Plaintext Secret'lar" bölümüne RESOLVED notu
- CLAUDE.md kapsam bölümüne migration init container eklendi
- Bloker / Risk listesi sadeleşti

### 2026-04-25 (Mac, geç saat) — CI Docker job optimizasyonu

PR-1 merge sonrası docker job 1+ saat sürdü (QEMU multi-arch). Çözüm:
- main push → amd64-only (~5dk): QEMU emülasyon yok, hızlı feedback
- `v*` tag push → multi-arch amd64+arm64 (release distribution için, M4 uyumlu)
- `:main-<sha7>` tag eklendi reproducibility için (`:latest` anti-pattern kısmen çözüldü, ADR-0008 notu)
- Cache scope per image (`scope=api` / `scope=web`) — bir image değişince diğerinin cache'i geçerliliğini koruyor
- `on.push.tags: ['v*']` eklendi — tag push'larda CI tetikleniyor

### 2026-04-25 (Mac M4) — Git history purge (BFG)

- BFG 1.15.0 ile `deploy/k8s/secret.yaml` tüm git history'den silindi
- Bare mirror clone → BFG → `git reflog expire` + `git gc --prune=now --aggressive` → force push
- Remote (GitHub) doğrulandı: eski commit'lerde artık `secret.yaml` içeriği yok
- Lokal repo da temizlendi (gc sonrası `git log --all --full-history -- secret.yaml` boş döndü)
- Win Claude session'ı `git pull` / re-clone yapmalı (hash'ler değişti)

### 2026-04-25 (Mac M4) — Secret rotation + .gitignore

- `deploy/k8s/secret.yaml` git tracking'den çıkarıldı (`git rm --cached`)
- `.gitignore`'a `deploy/k8s/secret.yaml` ve `deploy/k8s/*-secret.yaml` eklendi
- `deploy/k8s/secret.yaml.example` placeholder template commit'lendi
- Yeni `ENVANTER_MASTER_KEY`, `ENVANTER_JWT_SECRET`, `POSTGRES_PASSWORD`, `ENVANTER_DB_URL` üretildi (32/32/24 byte random base64)
- Cluster'da `kubectl create secret generic envanter-secret` ile apply edildi
- Postgres PVC sıfırlandı (test ortamı, fresh start) → StatefulSet + API pod'ları restart
- `configmap.yaml`'dan plaintext `ENVANTER_DB_URL` kaldırıldı; parça parça env'lere bölündü (`ENVANTER_DB_HOST/PORT/NAME/USER/SSLMODE`)
- `ENVANTER_DB_URL` artık Secret'tan geliyor (`kubectl create secret` ile)
- *Hâlâ TODO:* Git history'den eski secret'ları purge (BFG / git filter-repo) — ayrı task
- *Hâlâ TODO:* Sealed Secrets / External Secrets Operator adoption (Faz 5)

### 2026-04-25 — Cross-machine deploy work (Mac M4, paralel Claude session) — backfill

Bu entry, **Mac M4 üzerinde paralel olarak yapılan deploy çalışmasının** geriye dönük dokümantasyonu (RULES.md tracking discipline kuralı için). Çalışmayı yapan: Burak Haşlaman + Claude Sonnet 4.6 (Mac session).

**4 commit (sıralı):**

| Commit | Açıklama |
|--------|---------|
| `9d8894f` | feat: add Dockerfiles, k8s manifests, and GHCR CI pipeline |
| `48920ac` | fix: allow multi-document YAML in pre-commit + add ArgoCD Application |
| `002a9e3` | fix: add imagePullSecrets for GHCR private registry |
| `38c784e` | fix: build multi-platform images (amd64 + arm64) for M4 compatibility |

**Eklenen / değişen:**

- **`server/Dockerfile`** — Go multi-stage (golang:1.22-alpine → scratch); CGO disabled, ~20MB image
- **`web/Dockerfile`** + **`web/nginx.conf`** — Vite build → nginx; `/api` proxy + `/ws` WebSocket + SPA fallback
- **`deploy/k8s/`** (9 dosya) — namespace, configmap, secret, postgres (StatefulSet+PVC), api, web (NodePort 30830), adminer, mailhog, argocd-app
- **`.github/workflows/ci.yml`** — yeni `docker` job (push to main only): GHCR login + buildx + multi-arch push (amd64 + arm64); cache=gha
- **`.pre-commit-config.yaml`** — `check-yaml` için `--allow-multiple-documents` (k8s manifest'ler `---` içerir)
- **ADR-0008 (bu commit'te)** — Containerization + raw k8s + GHCR + ArgoCD GitOps. ADR-0001'in Helm tercihinden farklılaşma.

**Pattern:**
- main'e push = CI → Docker images (api, web) GHCR'a push → ArgoCD detect (polling) → envanter namespace sync. Tam GitOps.
- Multi-arch sayesinde Mac M4'te `kubectl run` veya kind/k3d ile yerel test sorunsuz.

**⚠️ Kritik bulgular ve yapılacaklar:**

1. **`deploy/k8s/secret.yaml` plaintext secret içeriyor** — `ENVANTER_MASTER_KEY`, `ENVANTER_JWT_SECRET`, `POSTGRES_PASSWORD` repo'da görünür. Repo private olsa bile sektör pratiği ihlali. **Acil aksiyonlar:**
   - Master key + JWT secret rotate (yeni rastgele 32B üret)
   - `secret.yaml`'ı `.gitignore`'a ekle
   - `secret.yaml.example` placeholder commit
   - Git history'den eski secret'ları purge (`git filter-repo` veya BFG)
   - Sealed Secrets / External Secrets / SOPS adoption (Faz 5)
2. `:latest` tag — git SHA / semver tag pin'lemesi gerekir (Faz 5)
3. Resource limits, HPA, Ingress, TLS, NetworkPolicy, Pod Security Standards eksik — Faz 5'e taşındı
4. DB migration init container yok — api Deployment'ına eklenmeli (Faz 2 PR-2 veya PR-3'te)

**Gözlem:** Pre-commit'in `gitleaks` hook'u secret leak'i yakalayamadı (k8s YAML secret kategorize etmedi). `gitleaks` config'ine custom rule eklenmesi düşünülecek.

### 2026-04-24 — Proje başlangıcı + Faz 0 tamamlandı
- Gereksinimler ve hedef netleşti (envanter app, DevOps/SRE takımı için, KeePassXC replacement).
- Tech stack kararı alındı: Go + Tauri + PostgreSQL 16 + monorepo (ADR-0001).
- Güvenlik modeli **hibrit** olarak belirlendi (ADR-0002):
  - Metadata → server-side envelope encryption
  - Secret field'lar → client-side E2E
  - Audit log → server-side plaintext
- Monorepo layout kararlaştırıldı (ADR-0003).
- 6 fazlı yol haritası çıkarıldı (tahmini 5-7 hafta).
- İlerleyiş takip dosyaları oluşturuldu: `CLAUDE.md`, `PROGRESS.md`, `RULES.md`, `TODO.md`.
- **Faz 0 kod iskeleti tamamlandı:**
  - Monorepo dizin yapısı (server/, client/, web/, shared/, deploy/, docs/, .github/)
  - Root config: `.gitignore`, `.editorconfig`, `README.md`, `LICENSE`, `Makefile`, `.env.example`, `go.work`
  - Go server: `cmd/api/main.go` (healthz endpoint, graceful shutdown), 7 internal paketi için doc.go
  - Docker Compose: Postgres 16 + Adminer + Mailhog
  - Linting: `.golangci.yml` + `.pre-commit-config.yaml` (gitleaks dahil secret tarama)
  - CI: `.github/workflows/ci.yml` — server job (gofmt + go mod tidy + golangci-lint + build + test -race) + pre-commit job
  - 3 ADR: tech-stack, security-model, repo-layout
  - Web scaffold: Vite + React 18 + TS + ESLint + Prettier
  - Tauri scaffold: Cargo.toml + tauri.conf.json + main.rs + lib.rs + Vite+React frontend
  - `docs/smoke-test.md` kullanıcı için doğrulama kılavuzu
- **Not:** Lokal dev ortamında Go/Node/Rust/Docker kurulu değil — smoke test user'ın kendi makinesinde yapılacak.

### 2026-04-24 (2. iş günü) — Faz 1 tasarım + implementasyon
- Repo lokal git'e alındı (`Desktop/Repos/Envanter_App`), ilk commit `c65a4be`.
- **Faz 1 — Veri modeli + kripto tasarımı tamamlandı.** Sıralı iş:
  1. ER diyagramı (Mermaid, 11 tablo). `users`, `user_keypairs`, `totp_secrets`, `recovery_codes`, `sessions`, `roles`, `user_roles`, `master_keys`, `folders`, `items`, `item_fields`, `item_shares`, `audit_log`.
  2. ADR-0004 — Şifreleme detayları: AES-256-GCM (nonce 12B, tag 16B, versiyonlu blob formatı), Argon2id (t=3, m=64MiB, p=4), X25519 sealed-box key wrap, HMAC-SHA256 search. Key hierarchy: KMS/Secret → master_key → server_dek (metadata); user_password → KEK → user_priv → e2e_dek (secrets).
  3. ADR-0005 — `goose` seçildi. SQL-first, embed, review-friendly. Atlas değerlendirildi, ekip tercihinde review-first felsefesine uymuyor.
  4. Auth akış dokümantasyonu — 9 senaryo Mermaid sequence ile. Register + TOTP enroll + login + refresh rotation + auto-lock + logout + password change + recovery + admin reset.
  5. **Review çıktıları (6 karar):**
     - UUID v7 client-üretimli ✓
     - MFA zorunlu; login'de TOTP, unlock'ta sadece master password
     - Recovery code → yeni keypair (solo item kaybı kabul, UI'da prominent uyarı)
     - Auto-lock default 10dk (5/10/15/30 configurable)
     - Searchable encryption HMAC hash — frequency leak kabul
     - Session binding = flag (block değil); token reuse detection → tüm session'lar revoke
  6. 5 migration (`00001` init extensions + `00002` users + `00003` roles + `00004` sessions + `00005` audit_log). pgcrypto, `set_updated_at()` trigger, CHECK constraints, partial index'ler, BRIN index audit_log'da.
  7. OpenAPI 3.1 spec — `shared/api/openapi.yaml`. Health + 10 auth endpoint (register, TOTP init/verify, login, refresh, logout, logout-all, change-password, recover/init, recover/complete).
  8. Code gen pipeline: `sqlc.yaml` + 4 query dosyası (users/sessions/roles/audit_log), `oapi-codegen.yaml`, Makefile `gen`/`gen-sqlc`/`gen-oapi-go`/`gen-oapi-ts`/`gen-check` hedefleri. `tools-install` hedefiyle Go tool'ları pin versiyonlu.

### 2026-04-24 (3. iterasyon) — Faz 1 genişleme: UX + RBAC + Vault tasarımı

Kullanıcı review sırasında ürün için 4 ek boyut tanımladı; hepsi için tasarım kararları alındı, belgeler güncellendi. **SQL migration'ları Faz 2'ye bırakıldı** (sadece admin rolü eklemesi 00003'te).

**Karar özeti:**
- **Objeler arası link** (`item_relationships` tablosu) — 5 edge tipi: `hosted_on`, `accessed_via`, `part_of`, `related_to`, `depends_on`. DevOps topolojisini yansıtır (DB ↔ sunucu, jump server zinciri).
- **Item tipleri** (`item_types` ayrı tablo, enum değil) — admin yeni tip ekleyebilir. 8 seed: server / url / database / ssh_key / certificate / cloud_credential / note / generic. Her tipin `suggested_fields` ve `default_launchers` (Faz 4) metadata'sı var.
- **Merkezi field sözlüğü** (`field_definitions` tablosu) — hostname/host_name drift'ini engeller. Type-to-search autocomplete UI'da. `field_type` içinde `enum` desteği (`allowed_values jsonb`) — `environment` (prod/stage/test/dev/lab) ve `criticality` (critical/high/medium/low) seed'li. `is_secret` artık tanımın parçası (E2E mi envelope mi otomatik).
- **3-katmanlı RBAC** — ADR-0006 §4:
  1. Global rol: `admin` / `write` / `read` (3 rol; admin rolü eklendi, 00003 revize)
  2. Klasör-level ACL: `folder_permissions` tablosu, `inherit_to_children`
  3. Item-level share: mevcut `item_shares`
  - Effective permission hesabı auth-flow.md'de pseudocode olarak.
- **External secret backends** (ADR-0007) — HashiCorp Vault **proxy** modeli:
  - Envanter Vault'tan DB'ye yazmaz, passthrough eder (E2E modeli bozulmaz)
  - `items.external_source jsonb` kolonu path referansı tutar
  - Kubernetes auth (k8s SA → Vault AppRole) MVP; OIDC SSO parking lot
  - Dynamic secrets (15dk kısa ömürlü DB cred) Faz 5+ bonus
  - **Manuel linking only** (MVP) — auto-discovery parking lot
- **Organizational convention** — proje/ortam folder düzeni + `environment` field cross-cutting sorgu için.

**Güncellenen dosyalar (9):**
- `docs/diagrams/er.mmd` — 17 tabloya çıktı (yeni: item_types, field_definitions, folder_permissions, item_relationships; modifiye: items +external_source, item_fields ↔ field_definitions)
- `docs/adr/0006-data-model-extensions.md` — YENİ
- `docs/adr/0007-external-secret-backends.md` — YENİ
- `docs/adr/README.md` — 0006 + 0007 index'e
- `docs/auth-flow.md` — RBAC 3 katman + endpoint matrix genişletildi
- `server/migrations/00003_roles.sql` — admin rolü seed'e
- `CLAUDE.md` — RBAC katmanları + Vault notu
- `PROGRESS.md` — bu entry
- `TODO.md` — Faz 2 migration listesi + Parking Lot güncellendi

### 2026-04-24 (4. iterasyon) — Repo konumu kuralı + tracking disiplini

- Claude-Chat / Repos divergence sorgulandı; yön netleştirildi: **Repos canonical, Claude-Chat legacy/donmuş**.
- `RULES.md`'ye yeni "Repo Konumu ve Tracking Dosyaları" bölümü eklendi:
  - Canonical dizin: `Desktop/Repos/Envanter_App`. Tüm yazılar absolute path ile bu konuma.
  - **Push öncesi zorunlu tracking güncelleme** matrisi (PROGRESS / TODO / CLAUDE / RULES / ADR / ER / OpenAPI). Asıl iş commit'i ile aynı commit'te.
  - Ayrı "docs commit" ANTI-PATTERN sayılır (review yükünü ikiye katlar).
- Bu kural pratikte zaten uygulanıyordu (Faz 1 commit'i bunu izlemişti); şimdi sözleşme yazılı.

## Mimari Kararlar (Özet)

| No | Karar | Durum |
|----|-------|-------|
| 0001 | Tech stack: Go + Tauri + Postgres + monorepo | Kabul (2026-04-24) |
| 0002 | Güvenlik modeli: hibrit (server-side envelope + client-side E2E) | Kabul (2026-04-24) |
| 0003 | Repo layout: monorepo | Kabul (2026-04-24) |
| 0004 | Şifreleme detayları: AES-256-GCM + Argon2id + X25519 + HMAC search | Kabul (2026-04-24) |
| 0005 | Migration tool: goose | Kabul (2026-04-24) |
| 0006 | Veri modeli: item_types, field_definitions, folder_permissions, item_relationships + admin rolü | Kabul (2026-04-24) |
| 0007 | External secret backends: Vault proxy (manuel linking, Faz 5 impl) | Kabul (2026-04-24) |
| 0008 | Containerization + raw k8s + GHCR + ArgoCD (Helm yerine, ADR-0001 deploy satırını değiştirir) | Kabul (2026-04-25) |

## Bloker / Risk / Not

- **2026-04-24:** Win lokal makinede Go, Node, Rust, Docker kurulu değil — CI'a push edilene kadar gerçek build/test verifikasyonu yok. Kullanıcı `docs/smoke-test.md`'deki adımları lokal dev makinesinde çalıştırmalı.
- Tauri iconları (Faz 4'te) eklenmeden `tauri:build` warning verebilir. `tauri:dev` sorunsuz çalışır.
- `go.sum`, `package-lock.json`, `Cargo.lock` henüz yok — ilk `go mod tidy` / `npm install` / `cargo build` komutlarında üretilecek ve commit'lenecek.
- **Faz 1 sonu:** Migration'lar Postgres üzerinde çalıştırılmadı (lokal ortam yok). Kullanıcı `make migrate-up` ile doğrulamalı.
- Code gen henüz çalıştırılmadı; `server/internal/db/sqlcgen/`, `server/internal/httpapi/apigen/`, `web/src/api/schema.gen.ts`, `client/src/api/schema.gen.ts` dosyaları yok. `make gen` ilk kez çalıştırıldığında üretilecek ve commit'lenmeli (CI `make gen-check` ile drift'i yakalar).
- ~~**🚨 KRİTİK 2026-04-25:** `deploy/k8s/secret.yaml` plaintext.~~ **ÇÖZÜLDÜ 2026-04-25 (Mac):** Rotate + `.gitignore` + BFG history purge + `secret.yaml.example` placeholder. Sealed Secrets adoption Faz 5 task'ında.
- ~~**2026-04-25:** PR-1 force-push gerekti.~~ **TAMAM:** PR-1 rebase + merge tamamlandı (`cb87259`).
- **2026-04-25 (akşam):** BFG history purge sonrası tüm commit hash'leri değişti. Win local `git reset --hard origin/main` ile sync edildi. Gelecekte yeni history purge olursa benzer sync gerekir.
