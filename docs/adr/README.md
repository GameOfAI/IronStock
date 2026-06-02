# Architecture Decision Records (ADR)

Mimari kararların tarihsel kaydı. Neden o karar verildi, alternatifler neydi, hangi sonuçlar bekleniyor — hepsi burada.

## Format

Her ADR kendi dosyasında. Dosya adı: `NNNN-kisa-baslik.md` (örn: `0004-database-migration-tool.md`).

Her dosyanın iskeleti:

```markdown
# NNNN — Başlık

- **Durum:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- **Tarih:** YYYY-MM-DD
- **Karar veren:** kişi/rol

## Bağlam
Neden bu karara ihtiyacımız var? Problem nedir?

## Karar
Ne karar verdik?

## Alternatifler
Değerlendirilen diğer seçenekler ve neden reddedildi.

## Sonuçlar
### Olumlu
### Olumsuz / Risk
### Nötr
```

## Ne Zaman ADR Yazılır?

- Stack değişikliği (Go'dan Rust'a geçiş gibi)
- Önemli mimari pattern seçimi (REST vs gRPC, SQL vs NoSQL)
- Kritik güvenlik / performans kararları
- Geri dönmesi zor olan kararlar

Küçük refactoring'ler veya kod içi kararlar için ADR yazılmaz — commit mesajı yeterli.

## Kabul Edilmiş ADR'ler

| No | Başlık | Tarih | Durum |
|----|--------|-------|-------|
| [0001](0001-tech-stack.md) | Tech stack: Go + Tauri + PostgreSQL + monorepo | 2026-04-24 | Accepted |
| [0002](0002-security-model.md) | Hibrit şifreleme: server-side envelope + client-side E2E | 2026-04-24 | Accepted |
| [0003](0003-repo-layout.md) | Monorepo layout: server/ + client/ + web/ + shared/ + deploy/ | 2026-04-24 | Accepted |
| [0004](0004-encryption-details.md) | Şifreleme detayları: AES-256-GCM + Argon2id + X25519 + HMAC search | 2026-04-24 | Accepted |
| [0005](0005-migration-tool.md) | Migration tool: goose (SQL-first, embed) | 2026-04-24 | Accepted |
| [0006](0006-data-model-extensions.md) | Veri modeli: item_types, field_definitions, folder_permissions, item_relationships + admin role | 2026-04-24 | Accepted |
| [0007](0007-external-secret-backends.md) | Vault proxy modeli (manuel linking) | 2026-04-24 | Implemented ✅ 2026-05-22 |
| [0008](0008-deployment-stack.md) | Containerization + raw k8s + GHCR + ArgoCD GitOps (Helm yerine) | 2026-04-25 | Accepted |
| [0009](0009-web-state-management.md) | Web client state management: Zustand + TanStack Query + Tailwind 4 + shadcn/ui | 2026-04-27 | Accepted |
| [0010](0010-bootstrap-admin-panel.md) | Bootstrap admin panel: acil yönetici erişimi (break-glass) | 2026-05-15 | Proposed |
| [0011](0011-item-search-model.md) | Item arama: name_plain + ILIKE substring search (ADR-0004 HMAC search'ü geçersiz kılar) | 2026-05-22 | Implemented ✅ 2026-05-22 |
| [0012](0012-development-tracking-discipline.md) | Geliştirme takip disiplini: PROGRESS.md + TODO.md pre-commit hook | 2026-05-24 | Accepted |
| [0013](0013-developer-portal.md) | Developer Portal: Backstage prensiplerini IronStock üzerine uygulamak | 2026-06-03 | Accepted |
