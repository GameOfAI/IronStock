---
name: ironstock-security
description: IronStock güvenlik modeli — hibrit E2E şifreleme, secret handling, JWT/TOTP pattern'ları ve input validation kuralları. Kripto, auth veya secret ile ilgili her kodlamada aktif olur.
---

# IronStock Güvenlik Modeli

## Şifreleme Katmanları

| Veri | Nerede şifrelenir | Algoritma |
|------|-------------------|-----------|
| Metadata (isim, IP, hostname) | Server-side envelope | AES-256-GCM, per-item DEK |
| Secret field'lar (parola, token, private key) | Client-side E2E | Argon2id → X25519 → AES-GCM |
| Paylaşılan item DEK | Client-side wrap | X25519 (alıcının public key'i) |
| Kullanıcı private key (DB'de) | KEK ile wrap | Argon2id türetilmiş KEK |

**Kural: Server secret field plaintext'i asla görmez.**

## Argon2id Parametreleri

- KDF: `Argon2id` — parola → KEK türetme
- KEK ile kullanıcının `private_key_enc` unwrap edilir (RAM'de tutulur)
- Login akışı: `parola → Argon2id → user_key → private_key çöz → item DEK unwrap`

## Secret Field Kuralları

```go
// Go struct tag — plaintext log'dan koru
type UserSecret struct {
    Password string `json:"-" log:"-"`
    TOTPSeed string `json:"-" log:"-"`
}
```

- Secret field'lar (parola, token, private key, TOTP seed) **asla plaintext log'lanmaz**
- `log:"-"` struct tag'i veya ayrı DTO kullan
- Error mesajları internal detay leak etmez (stack trace user'a dönmez)
- `secret.yaml` ve benzeri dosyalar `.gitignore`'da olmalı; repo'ya commit edilmez

## JWT Pattern

```
access_token:  15 dakika ömür, memory-only (localStorage değil)
refresh_token: 7 gün, rotating, HttpOnly cookie
```

- Kullanıcı disable edildiğinde tüm session'lar revoke edilir
- `RequireRole` middleware her korumalı route'da compose edilmeli

## Rate Limit Zorunluluğu

Şu endpoint'lerde rate limit olmadan merge edilmez:
- `POST /auth/login`
- `POST /auth/totp/verify`
- `POST /auth/recover`
- `POST /auth/change-password`

## Input Validation

- **Tüm dış input** validate edilmeli — struct tag veya explicit check
- Boundary: HTTP handler → service layer geçişinde validate et
- SQL: parameterized query kullan, string concat yasak
- File upload: content-type + boyut sınırı zorunlu (MinIO presigned URL)

## CORS

- `go-chi/cors` paketi kullanılır (elle yazılmış CORS middleware değil)
- `AllowedOrigins` production'da explicit whitelist, `*` yasak

## Audit Log

- Tüm mutasyonlar server-side plaintext kaydı — kim/ne/ne zaman
- Audit constant'ları `internal/audit/audit.go` dosyasında tanımlanır
- Yeni mutasyon endpoint'i → ilgili audit constant eklenmeli

## Kripto Kod Review Kontrol Listesi

Kripto değişikliklerinde şunları kontrol et:
- [ ] IV/nonce her şifrelemede unique üretiliyor mu?
- [ ] DEK rotate edildiğinde eski item_shares yeniden wrap ediliyor mu?
- [ ] KEK türetme parametreleri (`kek_salt`, `kek_params`) DB'de saklanıyor mu?
- [ ] Public key değiştiğinde item_shares kırılıyor mu? (change-password akışı)
- [ ] WebCrypto API browser uyumlu mu? (SubtleCrypto.importKey)
