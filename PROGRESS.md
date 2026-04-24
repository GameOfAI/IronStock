# İlerleyiş

Son güncelleme: 2026-04-24

## Mevcut Durum

- **Aktif Faz:** Faz 0 — Temel kurulum (kod tarafı tamam, kullanıcı smoke test'i bekleniyor)
- **Tamamlanan Faz:** —
- **Bloker:** Yok
- **Bir sonraki adım:** Kullanıcının lokal dev makinesinde `docs/smoke-test.md` adımlarını çalıştırması. Yeşil olursa Faz 1'e geçilir.

## Faz Durumu

| Faz | Durum | Başlangıç | Bitiş | Not |
|-----|-------|-----------|-------|-----|
| 0 — Temel kurulum | VERIFY | 2026-04-24 | — | Kod yazıldı, user smoke test'i bekleniyor |
| 1 — Veri modeli + kripto tasarımı | TODO | — | — | ER diyagram + ADR'ler + migration iskeleti |
| 2 — Server MVP | TODO | — | — | Auth + RBAC + CRUD + WebSocket + audit |
| 3 — Admin Web UI | TODO | — | — | Login + user mgmt + ağaç view |
| 4 — Client MVP (Tauri) | TODO | — | — | Win+Mac, live sync, offline cache, E2E |
| 5 — Production hardening | TODO | — | — | Helm + secrets + metrics + packaging |

Durumlar: `DONE` tamamlandı · `ACTIVE` devam ediyor · `VERIFY` doğrulama bekliyor · `BLOCKED` bloke · `TODO` beklemede

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

## Günlük

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

## Mimari Kararlar (Özet)

Tam ADR'ler `docs/adr/` altında (Faz 0 task'ı olarak oluşturulacak).

| No | Karar | Durum |
|----|-------|-------|
| 0001 | Tech stack: Go + Tauri + Postgres + monorepo | Kabul edildi (2026-04-24) |
| 0002 | Güvenlik modeli: hibrit (server-side envelope + client-side E2E) | Kabul edildi (2026-04-24) |
| 0003 | Repo layout: monorepo (server/ + client/ + web/ + shared/ + deploy/ + docs/) | Kabul edildi (2026-04-24) |

## Bloker / Risk / Not

- **2026-04-24:** Lokal makinede Go, Node, Rust, Docker kurulu değil — CI'a push edilene kadar gerçek build/test verifikasyonu yok. Kullanıcı `docs/smoke-test.md`'deki adımları lokal dev makinesinde çalıştırmalı.
- Tauri iconları (Faz 4'te) eklenmeden `tauri:build` warning verebilir. `tauri:dev` sorunsuz çalışır.
- `go.sum`, `package-lock.json`, `Cargo.lock` henüz yok — ilk `go mod tidy` / `npm install` / `cargo build` komutlarında üretilecek ve commit'lenecek.
