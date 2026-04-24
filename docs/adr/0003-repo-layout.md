# 0003 — Monorepo Layout

- **Durum:** Accepted
- **Tarih:** 2026-04-24
- **Karar veren:** Burak Haşlaman (DevOps/SRE)

## Bağlam

Proje 3 bağımsız deploy edilebilir komponent içerir:
1. **Server** (Go, k8s'te)
2. **Desktop Client** (Tauri, son kullanıcı makinelerinde)
3. **Admin Web UI** (React SPA, server'dan veya ayrı host'tan serve edilir)

Ek olarak ortak **API kontratı** (OpenAPI) var — 3 tarafta da kullanılıyor.

Kod organizasyon seçenekleri:
- **Polyrepo:** Her komponent kendi repo'sunda, versiyonlar arası uyum manuel.
- **Monorepo:** Tek repo, alt dizinlerde komponentler, tek CI.

## Karar

**Monorepo** seçildi. Layout:

```
Envanter_App/
├── server/                  # Go backend
│   ├── cmd/api/             # entrypoint
│   ├── internal/            # domain package'leri
│   │   ├── auth/
│   │   ├── crypto/
│   │   ├── db/
│   │   ├── httpapi/         # REST layer
│   │   ├── ws/              # WebSocket hub
│   │   ├── audit/
│   │   └── config/
│   ├── migrations/          # goose migrations
│   └── go.mod
├── client/                  # Tauri desktop app
│   ├── src-tauri/           # Rust backend
│   └── src/                 # TS + React frontend
├── web/                     # Admin UI (React + Vite)
│   └── src/
├── shared/                  # Ortak kontrat
│   └── api/                 # OpenAPI spec + generated types
├── deploy/
│   ├── compose/             # Dev stack
│   └── helm/                # k8s deployment (Faz 5)
├── docs/
│   ├── adr/                 # Bu klasör
│   └── diagrams/            # Mermaid / excalidraw
├── .github/workflows/       # CI
├── CLAUDE.md                # Proje context
├── PROGRESS.md              # İlerleyiş
├── RULES.md                 # Kurallar
├── TODO.md                  # Yapılacaklar
├── Makefile                 # Ortak komutlar
├── go.work                  # Go workspace
└── README.md
```

### Kodlar arası bağımlılık
- **Tek bağ:** `shared/api/openapi.yaml`.
- Server bu şemadan Go stub'ları üretir (`oapi-codegen` veya manuel).
- Web + Client bu şemadan TypeScript tipleri üretir (`openapi-typescript`).
- Generated code `.gitignore`'da — her build'de yeniden üretilir.

### CI Strategy
- Tek workflow, komponent bazlı job'lar (`server`, `web`, `client`, `pre-commit`).
- Path filter **yok** (en azından şimdilik): her değişiklikte hepsi çalışır → API şema değişince tüm taraflarda tip hatası yakalanır.
- Tek versiyon etiketi (`v1.0.0` → 3 komponent de aynı anda release).

## Alternatifler

### A) Polyrepo (3 ayrı repo)
- **Artıları:** Her komponent bağımsız CI süresi kısa, izolasyon temiz, versiyon kontrolü bağımsız.
- **Eksileri:**
  - API şema değişikliği → 3 repo'da 3 PR, hata yakalamak gecikmeli.
  - Local geliştirmede 3 repo clone + link zorluk.
  - Versiyon matrisi: "client v1.2 server v1.3 ile uyumlu mu?" sorusu sürekli.
- **Reddedildi** çünkü 3 komponent sıkı couple'lu (API kontratı) ve versiyonlama ekstra yük.

### B) Nx / Turborepo / Bazel
- **Artıları:** Akıllı caching, affected-only build.
- **Reddedildi** şimdilik çünkü proje küçük (3 komponent), araç overhead'i faydadan fazla. Ileride build süresi sorun olursa Turborepo eklenebilir.

### C) Git submodules
- **Reddedildi** çünkü submodule yönetim zorluğu ve CI komplikasyonları (herkes biliyor).

## Sonuçlar

### Olumlu
- API şema değişimi atomic commit → 3 tarafta tip uyumu CI'da yakalanır.
- Tek `make build` tüm sistemi derler.
- ADR ve docs tek yerde.
- Shared tooling (linter config, CI action'ları) tek yerde.

### Olumsuz / Risk
- CI süresi uzar (hepsi birden build). Path filter ile optimize edilebilir, ama şimdilik güvenlik > hız.
- Repo büyüdükçe clone süresi artar. Shallow clone ve Git LFS (binary asset'ler için) ileride faydalı olabilir.
- Takım büyürse code ownership karmaşıklaşabilir → `CODEOWNERS` dosyası ile çözülür (Faz 5).

### Nötr
- Release süreci: tüm komponent aynı versiyonda release edilir. Bu **kasıtlı**: client ve server versiyon uyumsuzluğunu tasarım zamanında önler.
