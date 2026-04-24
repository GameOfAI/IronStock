# Faz 0 Smoke Test

Faz 0 tamamlandığında bu checklist'i çalıştır. Hepsi yeşil ise Faz 1'e geçilebilir.

## Gereksinimler

Makinede kurulu olmalı:
- [ ] Docker Desktop (veya compatible) + Docker Compose v2
- [ ] Go 1.22+
- [ ] Node 20+
- [ ] Rust 1.75+ (rustup üzerinden)
- [ ] Platform build tools (Windows: MSVC Build Tools + WebView2; macOS: Xcode CLI)
- [ ] `golangci-lint` (`go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.55.2`)
- [ ] `pre-commit` (`pip install pre-commit` — opsiyonel ama önerilir)

## 1. Repo doğrulaması

```bash
cd Envanter_App
ls -la
```

Beklenen dosyalar:
- `CLAUDE.md`, `PROGRESS.md`, `RULES.md`, `TODO.md`
- `README.md`, `LICENSE`, `Makefile`
- `.gitignore`, `.editorconfig`, `.env.example`, `.pre-commit-config.yaml`, `go.work`
- Dizinler: `server/`, `client/`, `web/`, `shared/`, `deploy/`, `docs/`, `.github/`

## 2. Dev stack

```bash
make up
make ps
```

Beklenen: 3 servis `Up (healthy)` durumunda.
- `postgres` → `localhost:5432` (envanter / envanter_dev)
- `adminer` → http://localhost:8081
- `mailhog` → http://localhost:8025

Psql ile bağlan:
```bash
psql postgres://envanter:envanter_dev@localhost:5432/envanter -c "SELECT version();"
```

Beklenen: Postgres 16.x sürümü.

## 3. Server build + test

```bash
cd server
go mod tidy       # go.sum oluşur (ilk çalıştırmada)
gofmt -l .        # boş çıktı = her şey formatlı
go build ./...    # hata yok
go test ./...     # 0 test + no such file ok (Faz 0'da test yok)
go run ./cmd/api  # :8080'de dinlemeye başlar
```

Başka terminalde:
```bash
curl http://localhost:8080/healthz
# Beklenen: {"status":"ok"}
```

Ctrl+C ile durdur.

## 4. Lint

```bash
cd server
golangci-lint run ./...
# Beklenen: "0 issues"
```

## 5. Web build

```bash
cd web
npm install
npm run build     # dist/ klasörü oluşur
npm run lint      # 0 error
```

Opsiyonel geliştirme:
```bash
npm run dev       # http://localhost:5173
```

## 6. Tauri client build

```bash
cd client
npm install
npm run tauri:dev   # Tauri dev window açılır; frontend hot-reload çalışır
```

Üretim build (opsiyonel, uzun sürer):
```bash
npm run tauri:build
# Windows: installer → src-tauri/target/release/bundle/msi/
# macOS: .dmg → src-tauri/target/release/bundle/dmg/
```

> Not: İkon dosyaları eksik olduğu için `tauri:build` uyarı verebilir. Faz 4'te gerçek ikonlar eklenecek.

## 7. Pre-commit hooks (opsiyonel)

```bash
pre-commit install
pre-commit run --all-files
# Beklenen: tüm hook'lar passed
```

## 8. CI doğrulaması

GitHub'a push ettikten sonra Actions sekmesinde:
- [ ] `server` job yeşil
- [ ] `pre-commit` job yeşil

## Geçiş Kriterleri

Aşağıdaki tüm maddeler ✅ ise Faz 1'e geçilebilir:

- [ ] `make up` 3 servisi sağlıklı başlatıyor
- [ ] `go build ./...` hatasız
- [ ] `go run ./cmd/api` + `/healthz` 200 dönüyor
- [ ] `golangci-lint run` 0 issue
- [ ] `web: npm run build` başarılı
- [ ] `client: npm run tauri:dev` pencere açıyor
- [ ] CI yeşil (en azından `server` ve `pre-commit` job'ları)

## Bilinen Eksikler (Faz 0 sonu)

Bu maddeler bilinçli olarak sonraki fazlara bırakıldı:
- Gerçek iconlar (Faz 4)
- Migration framework entegrasyonu (Faz 1)
- `client` / `web` CI job'ları (Faz 3/4 — o fazlarda aktif olurlar)
- ESLint plugin'leri için `npm install` gerekli (paketler listelendi ama lock file yok)
- `go.sum` henüz oluşturulmadı (ilk `go mod tidy`'de oluşur)
