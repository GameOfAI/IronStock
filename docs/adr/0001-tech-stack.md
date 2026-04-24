# 0001 — Tech Stack

- **Durum:** Accepted
- **Tarih:** 2026-04-24
- **Karar veren:** Burak Haşlaman (DevOps/SRE)

## Bağlam

DevOps/SRE takımı için merkezi envanter uygulaması geliştiriyoruz. Şu gereksinimler var:
- Server Kubernetes üzerinde çalışacak.
- Desktop client Windows + macOS'ta native çalışmalı, KeePassXC'ye benzer UX.
- Admin için ayrı bir web paneli.
- Live sync (WebSocket) + offline cache.
- MFA (TOTP) + RBAC.
- Hassas veri (credential) içeriyor — küçük attack surface kritik.

Takımın Go, k8s, Docker, Postgres ile güçlü deneyimi var. Rust ve TypeScript'te orta seviye deneyim.

## Karar

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| Backend dili | **Go** | 1.22+ |
| HTTP router | chi (Faz 2'de) | v5 |
| DB driver | pgx + sqlc | en güncel |
| Veritabanı | **PostgreSQL** | 16 |
| Migration | goose | v3 |
| Desktop client | **Tauri** | 2.x |
| Client frontend | React + TypeScript + Vite | React 18, TS 5 |
| Admin web | **React + Vite + TypeScript** | React 18, TS 5 |
| CI | **GitHub Actions** | — |
| Dev stack | **Docker Compose** | v2 |
| Deploy | **Kubernetes + Helm** | Helm 3 |

## Alternatifler

### Backend dili: Rust / Python (FastAPI) / Node.js

- **Rust:** Maksimum güvenlik ve performans. Reddedildi çünkü takımda Rust deneyimi sınırlı — server için learning curve projeyi yavaşlatır. Zaten client'ta Tauri üzerinden Rust var.
- **Python (FastAPI):** Hızlı prototip, geniş ekosistem. Reddedildi çünkü tek binary deploy'u zor, runtime footprint büyük, GIL bazı eşzamanlılık senaryolarında (WebSocket fanout) dezavantaj.
- **Node.js:** Tek dil (TS) server+client. Reddedildi çünkü kripto-yoğun iş için Go stdlib daha olgun, k8s ekosistemindeki mevcut Go bilgisi değerlendirilemez.

**Kazanan — Go:** Küçük statik binary, k8s-native ekosistem, takım deneyimi, crypto/net stdlib olgunluğu.

### Desktop client: Electron / Qt / .NET MAUI

- **Electron:** En tanıdık. Reddedildi çünkü binary ~150MB, RAM kullanımı yüksek, Node.js process credential barındıran bir app için geniş attack surface.
- **Qt:** Native performans. Reddedildi çünkü C++ geliştirme hızı düşük, takımda Qt deneyimi yok.
- **.NET MAUI:** Cross-platform. Reddedildi çünkü macOS desteği henüz Windows kadar olgun değil, runtime dependency büyük.

**Kazanan — Tauri:** Binary ~10MB, Rust backend = küçük attack surface, WebView ile tanıdık web frontend stack. Tauri 2 mobile desteği de veriyor (ileride faydalı).

### Veritabanı: SQLite / MySQL / MongoDB

- **SQLite:** Reddedildi çünkü multi-user concurrent write + row-level security gerekiyor.
- **MySQL:** Geçerli alternatif. Reddedildi çünkü Postgres'in JSONB, array types, transactional DDL, daha iyi full-text search, ve pgcrypto extension'ı bu use-case için daha uygun.
- **MongoDB:** Reddedildi çünkü ilişkisel yapı (users ↔ roles ↔ folders ↔ items ↔ shares) doğal olarak SQL, şema disiplini bir secret manager için daha güvenli.

## Sonuçlar

### Olumlu
- Tek binary Go server → deploy kolay, image küçük (~20MB).
- Tauri ile küçük binary, küçük attack surface.
- Tüm stack'te olgun crypto kütüphaneleri.
- Takımın mevcut bilgisine uyumlu (Go, Postgres, k8s).
- OpenAPI spec + sqlc + openapi-typescript üçlüsü ile compile-time API güvenliği (server, client, web aynı şemayı kullanır).

### Olumsuz / Risk
- Tauri 2 görece yeni → bazı plugin ekosistemi Electron kadar zengin değil.
- Takımın Rust deneyimi sınırlı → Tauri Rust tarafını mümkün olduğunca ince tutmalıyız (business logic frontend'de).
- Go'da generic'ler görece yeni → bazı libraryler hâlâ reflect tabanlı.

### Nötr
- Monorepo (bkz. ADR-0003) → CI karmaşıklığı artar ama tek source of truth.
