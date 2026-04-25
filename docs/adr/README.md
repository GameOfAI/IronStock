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
| [0007](0007-external-secret-backends.md) | Vault proxy modeli (manuel linking, Faz 5 impl) | 2026-04-24 | Accepted |
| [0008](0008-deployment-stack.md) | Containerization + raw k8s + GHCR + ArgoCD GitOps (Helm yerine) | 2026-04-25 | Accepted |
