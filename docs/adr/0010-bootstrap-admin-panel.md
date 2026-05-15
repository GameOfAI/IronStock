# 0010 — Bootstrap Admin Panel (Acil Yönetici Erişimi)

- **Durum:** Proposed
- **Tarih:** 2026-05-15
- **Karar veren:** Burak Haşlaman (DevOps/SRE)

## Bağlam

### Problem

Normal login akışı `username + password + totp_code` üçlüsünü zorunlu kılıyor
(`auth_login.go:59`). Bu tasarım kasıtlı ve güvenli; ancak iki bootstrapping senaryosunda
kilitlenmeye yol açıyor:

1. **`pending_totp` durumu:** Seed script ile veya DB migration'ı ile oluşturulan admin
   hesabı henüz TOTP kurulumu yapmamış. Login `403 account_pending_mfa` veriyor. TOTP
   kurulum wizard'ı ise React UI'ında ve UI'a giremeden başlamıyor → kilitlenme.

2. **TOTP cihazı kaybı:** Admin authenticator uygulamasını kaybettiyse (`pending_totp`
   değil `active` durumda olsa bile) TOTP kodu üretemez. Recovery flow da UI erişimi
   gerektirir → aynı kilitlenme.

Her iki durumda da "uygulama içinde yetkilendirme yap" hedefi çürümekte: kimin `admin`
rolü alacağına ilk karar verecek kişi sisteme giremez.

### Gereksinimler

- Sadece `admin` rolüne sahip kullanıcılar erişebilmeli.
- TOTP atlanabilmeli (acil erişimin amacı bu).
- Şifre doğrulaması **kesinlikle** korunmalı (Argon2id).
- Her erişim audit log'a düşmeli.
- İsteğe bağlı olarak devre dışı bırakılabilmeli (prod'da kapalı tutulabilmeli).
- Mevcut admin API endpoint'leri yeniden kullanılabilmeli.

## Karar

### Yöntem Seçimi

Üç alternatif değerlendirildi:

| Yöntem | Artılar | Eksiler |
|--------|---------|---------|
| **A) Bootstrap API endpoint + React route** | Mevcut bileşenleri yeniden kullanır, az kod | Path React bundle'da görünür |
| B) Go server-side HTML admin sayfası | Path gizlenebilir, JS bağımlısı yok | Yeni template sistemi, mevcut admin bileşenleriyle uyumsuz |
| C) Tek kullanımlık token seeding | Güçlü güvenlik | Karmaşık ops flow, k8s secret rotation gerekir |

**Karar: Yöntem A** — Servis katmanında yeni `POST /api/v1/auth/bootstrap` endpoint'i,
frontend'de ayrı bir `/admin-setup` React route'u. Güvenlik yükü pathin gizliliğine değil,
credential doğrulamasına, rate limiting'e ve audit log'a dayanıyor.

### Tasarım

#### Server (Go)

**Yeni endpoint:** `POST /api/v1/auth/bootstrap`

```
Giriş:
  Authorization: Basic base64(username:password)

Başarı (200):
  { "access_token": "...", "expires_in": 3600, "user_id": "...", "roles": [...] }

Hatalar:
  401 invalid_credentials  — şifre yanlış veya admin rolü yok
  403 account_disabled     — hesap disabled statüsünde
  429                      — rate limit aşıldı
  503 bootstrap_disabled   — ENVANTER_BOOTSTRAP_ENABLED=false (default)
```

**Doğrulama adımları** (handler'da sırasıyla):

1. `ENVANTER_BOOTSTRAP_ENABLED` kontrolü → false ise 503
2. `Authorization: Basic` header parse → eksikse 401
3. DB'den kullanıcı satırı çek (`fetchUserForLogin`)
4. Hesap `disabled` kontrolü → disabled ise 403
5. Argon2id şifre doğrulama → yanlışsa 401 + `recordLoginFailure` (lockout uygulanır)
6. DB'den roller çek, `admin` rolü yoksa 401
7. Session oluştur, JWT ver (`purpose=bootstrap`, `expires_in=3600`)
8. Audit: `auth.bootstrap_login` action, `details: {via: "bootstrap_panel"}`

> **Not:** `pending_totp` ve `active` durumlar her ikisi de geçiyor.
> `disabled` engeli korunuyor — bootstrap devre dışı bırakılmış hesabı canlandırmaz.

**Verilen JWT:** Mevcut `RequireAccessToken` + `RequireRole(RoleAdmin)` middleware'ini
geçmelidir. `auth.Service.JWT.IssueAccess` ile üretilir; session tablosuna kaydedilir
(logout ile iptal edilebilir). Lifetime: **1 saat** (standart access token 15dk, bootstrap
biraz uzun tutuldu — ops makul sürede işini bitirebilsin).

**Yeni config alanı:**
```
ENVANTER_BOOTSTRAP_ENABLED=false   # default; prod'da false kalır
```

**Yeni audit action:** `auth.bootstrap_login`

**Rate limiting:** Mevcut `authBruteRL` limiter'ı (12s/attempt, 5 burst). Hesap lockout da
uygulanır (`recordLoginFailure`).

#### Frontend (React + TypeScript)

**Yeni route:** `/admin-setup`

Akış:
1. Kullanıcı `/admin-setup` URL'ine gider.
2. Basit form: `username` + `password` alanları (TOTP alanı yok).
3. Submit → `POST /api/v1/auth/bootstrap` (Basic Auth header).
4. Başarı: `access_token` memory'e alınır, standart auth store'a yazılır.
5. Redirect → `/admin/users` (mevcut admin kullanıcı yönetimi sayfası).
6. `AppShell` üstünde sarı **"Bootstrap Modu"** banner'ı — kullanıcıyı uyarır.

**Yeni dosyalar:**
```
web/src/pages/admin-setup.tsx          — form + auth mantığı
web/src/api/bootstrap.ts               — API call helper
```

**Değişen dosyalar:**
```
web/src/App.tsx                        — yeni route eklenir
web/src/components/layout/app-shell.tsx — bootstrap banner
server/internal/config/config.go       — BootstrapEnabled bool
server/internal/httpapi/router.go      — yeni endpoint mount
server/internal/httpapi/auth_handlers.go — handler struct'a BootstrapEnabled wire
server/internal/httpapi/auth_bootstrap.go — yeni dosya
server/internal/audit/audit.go         — ActionAuthBootstrapLogin sabiti
```

#### Güvenlik Değerlendirmesi

| Risk | Etki | Azaltma |
|------|------|---------|
| TOTP atlanıyor | Tek faktör yeterli | Argon2id zorunlu, admin-only, audit log, rate limit + lockout |
| React bundle'da path | Path tahmin edilebilir | Gerçek güvenlik credential'da; path security-by-obscurity değil |
| Uzun token ömrü (1h) | Çalınan token daha uzun geçerli | Session tablosuna yazılır → logout ile iptal edilebilir |
| `disabled` hesap bypass | — | Yok; `disabled` kontrolü bootstrap'ta da yapılıyor |
| Brute force | Lockout tetiklenmeden çok deneme | authBruteRL + hesap lockout mekanizması aynı şekilde çalışıyor |

**Prod önerisi:** `ENVANTER_BOOTSTRAP_ENABLED` sadece bootstrap işlemi için `true`'ya alınır,
işlem biter bitmez `false`'a döndürülür. İdeal: SealedSecret güncelleme + rolling restart.

## Kabul Edilmeyenler

- TOTP reset endpoint'i bu ADR kapsamı dışında (başka bir istek). Bootstrap panel hem
  `pending_totp` hem `active`+TOTP-kayıp durumunu çözüyor; reset ayrı özellik.
- Grup/takım tabanlı yetkilendirme (Parking Lot'ta).
- WebAuthn/FIDO2 hardware key (Parking Lot'ta).

## Sonuç

Bootstrap Admin Panel, TOTP zorunluluğunu kalıcı olarak değiştirmez; sadece kilitlenme
durumlarında geçici bir acil çıkış kapısı açar. Güvenlik modeli (ADR-0002) özünde korunuyor:
şifre doğrulaması, audit log, rate limit ve hesap lockout devrede. Prod'da default olarak
kapalı.
