# Plan: Bootstrap Admin Panel (PR-B1)

**Branch:** `feat/bootstrap-admin`  
**ADR:** [0010-bootstrap-admin-panel.md](adr/0010-bootstrap-admin-panel.md)  
**Hedef:** TOTP kilitlenmesini çöz; admin kullanıcısı şifre+Basic Auth ile giriş yapıp
yetkilendirme işlemlerini yönetebilsin.

---

## Genel Bakış

```
[Browser]  GET /admin-setup
           ──────────────────────────────────────────►  React SPA
           username + password form (TOTP yok)
           POST /api/v1/auth/bootstrap (Basic Auth header)
           ──────────────────────────────────────────►  Go server
                                                        BootstrapEnabled? ✓
                                                        Argon2id doğrula
                                                        admin rol kontrolü
                                                        Session yaz, JWT ver
           ◄──────────────────────────────────────────  { access_token }
           Redirect → /admin/users
           (Mevcut admin UI — rol/kullanıcı yönetimi)
```

---

## Adım Adım Plan

### 1 — Server: Config

**Dosya:** `server/internal/config/config.go`

Mevcut `Config` struct'ına bir bool alanı ekle:

```go
BootstrapEnabled bool  // ENVANTER_BOOTSTRAP_ENABLED, default false
```

`loadFromEnv` fonksiyonunda:
```go
cfg.BootstrapEnabled = os.Getenv("ENVANTER_BOOTSTRAP_ENABLED") == "true"
```

---

### 2 — Server: Audit sabiti

**Dosya:** `server/internal/audit/audit.go`

Mevcut sabit bloğuna ekle:

```go
ActionAuthBootstrapLogin = "auth.bootstrap_login"
```

---

### 3 — Server: Bootstrap handler

**Yeni dosya:** `server/internal/httpapi/auth_bootstrap.go`

```go
package httpapi

import (
    "encoding/base64"
    "errors"
    "net/http"
    "strings"

    "envanter.app/server/internal/audit"
    "envanter.app/server/internal/auth"
    "envanter.app/server/internal/crypto"
)

// BootstrapLogin implements POST /api/v1/auth/bootstrap.
//
// HTTP Basic Auth: Authorization: Basic base64(username:password).
// TOTP is intentionally skipped — this endpoint exists for the bootstrapping
// catch-22 where an admin has no TOTP configured or has lost their authenticator.
//
// Security invariants that ARE enforced:
//   - Argon2id password verification (same as regular login)
//   - admin role required in DB
//   - disabled accounts are rejected
//   - rate limiting + account lockout apply
//   - every access is audit-logged
//   - endpoint is disabled unless ENVANTER_BOOTSTRAP_ENABLED=true
func (s *AuthHandlers) BootstrapLogin(w http.ResponseWriter, r *http.Request) {
    if !s.BootstrapEnabled {
        writeError(w, s.Logger, http.StatusServiceUnavailable, ErrCodeInternal,
            "Bootstrap paneli bu sunucuda etkin değil.", errors.New("bootstrap disabled"))
        return
    }

    username, password, ok := parseBasicAuth(r)
    if !ok {
        w.Header().Set("WWW-Authenticate", `Basic realm="IronStock Bootstrap"`)
        writeError(w, s.Logger, http.StatusUnauthorized, ErrCodeUnauthorized,
            "Basic Auth gerekli.", errors.New("missing basic auth"))
        return
    }

    ctx := r.Context()
    userRow, err := fetchUserForLogin(ctx, s.Service.DB, strings.ToLower(username))
    if err != nil {
        s.recordLoginFail(ctx, r, "", "user_not_found")
        writeInvalidCreds(w, s.Logger, errors.New("user not found"))
        return
    }

    if userRow.Status == "disabled" {
        s.recordLoginFail(ctx, r, userRow.ID, "disabled")
        writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
            "Hesap devre dışı.", errors.New("disabled"))
        return
    }

    if auth.IsLocked(userRow.LockedUntil) {
        s.recordLoginFail(ctx, r, userRow.ID, "locked")
        writeError(w, s.Logger, http.StatusForbidden, ErrCodeAccountLocked,
            "Hesap geçici olarak kilitli.", errors.New("locked"))
        return
    }

    salt, err := extractSaltFromParams(userRow.Argon2Params)
    if err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Şifre parametreleri okunamadı.", err)
        return
    }
    pwOK, err := auth.VerifyPassword(password, userRow.PasswordHash, salt, userRow.Argon2Params)
    if err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Şifre doğrulanamadı.", err)
        return
    }
    if !pwOK {
        _ = recordLoginFailure(ctx, s.Service.DB, userRow.ID)
        s.recordLoginFail(ctx, r, userRow.ID, "wrong_password")
        writeInvalidCreds(w, s.Logger, errors.New("wrong password"))
        return
    }

    // Require admin role — bootstrap panel is admin-only.
    roles, err := fetchUserRoles(ctx, s.Service.DB, userRow.ID)
    if err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Roller okunamadı.", err)
        return
    }
    hasAdmin := false
    for _, role := range roles {
        if role == RoleAdmin {
            hasAdmin = true
            break
        }
    }
    if !hasAdmin {
        s.recordLoginFail(ctx, r, userRow.ID, "not_admin")
        writeInvalidCreds(w, s.Logger, errors.New("not admin"))
        return
    }

    refresh, err := auth.GenerateRefresh()
    if err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Refresh token üretilemedi.", err)
        return
    }

    tx, err := s.Service.DB.Begin(ctx)
    if err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Veritabanı hatası.", err)
        return
    }
    defer func() { _ = tx.Rollback(ctx) }()

    if err := recordLoginSuccess(ctx, tx, userRow.ID); err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Login durumu güncellenemedi.", err)
        return
    }

    sessionID, err := auth.CreateSession(ctx, tx,
        userRow.ID, refresh.Hash,
        r.UserAgent(), parseIP(r.RemoteAddr),
        refresh.ExpiresAt,
    )
    if err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Oturum oluşturulamadı.", err)
        return
    }

    if err := tx.Commit(ctx); err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "İşlem tamamlanamadı.", err)
        return
    }

    // Issue access token with full 1-hour lifetime for bootstrap sessions.
    // Uses the standard IssueAccess so existing admin middleware accepts it.
    accessToken, err := s.Service.JWT.IssueAccess(userRow.ID, sessionID, roles)
    if err != nil {
        writeError(w, s.Logger, http.StatusInternalServerError, ErrCodeInternal,
            "Access token üretilemedi.", err)
        return
    }

    _ = s.Audit.Write(ctx, audit.Entry{
        ActorUserID:  userRow.ID,
        Action:       audit.ActionAuthBootstrapLogin,
        ResourceType: audit.ResourceSession,
        ResourceID:   sessionID,
        Details:      map[string]any{"via": "bootstrap_panel"},
        IPAddress:    parseIP(r.RemoteAddr),
        UserAgent:    r.UserAgent(),
    })

    writeJSON(w, http.StatusOK, loginResponse{
        AccessToken:  accessToken,
        RefreshToken: refresh.Token,
        ExpiresIn:    int(auth.AccessTokenLifetime.Seconds()),
        TokenType:    "Bearer",
        UserID:       userRow.ID,
        Roles:        roles,
    })
}

// parseBasicAuth decodes the Authorization: Basic header.
func parseBasicAuth(r *http.Request) (username, password string, ok bool) {
    auth := r.Header.Get("Authorization")
    if !strings.HasPrefix(auth, "Basic ") {
        return "", "", false
    }
    decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, "Basic "))
    if err != nil {
        return "", "", false
    }
    parts := strings.SplitN(string(decoded), ":", 2)
    if len(parts) != 2 {
        return "", "", false
    }
    return parts[0], parts[1], true
}
```

---

### 4 — Server: AuthHandlers'a BootstrapEnabled ekle

**Dosya:** `server/internal/httpapi/auth_handlers.go`

```go
type AuthHandlers struct {
    Service          *auth.Service
    Audit            *audit.Writer
    Logger           *slog.Logger
    BootstrapEnabled bool   // yeni alan
}
```

`cmd/api/main.go`'da wire:
```go
authHandlers := &httpapi.AuthHandlers{
    Service:          authSvc,
    Audit:            auditWriter,
    Logger:           logger,
    BootstrapEnabled: cfg.BootstrapEnabled,
}
```

---

### 5 — Server: Router'a mount et

**Dosya:** `server/internal/httpapi/router.go`

`/api/v1/auth` route grubuna ekle (authBruteRL altında):

```go
ar.With(authBruteRL.Middleware).Post("/bootstrap", d.Auth.BootstrapLogin)
```

---

### 6 — Frontend: API helper

**Yeni dosya:** `web/src/api/bootstrap.ts`

```typescript
import { apiFetch } from './client'

export interface BootstrapLoginResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  user_id: string
  roles: string[]
}

export async function bootstrapLogin(
  username: string,
  password: string,
): Promise<BootstrapLoginResponse> {
  const credentials = btoa(`${username}:${password}`)
  return apiFetch<BootstrapLoginResponse>('/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  })
}
```

---

### 7 — Frontend: Admin Setup sayfası

**Yeni dosya:** `web/src/pages/admin-setup.tsx`

- `username` + `password` input'ları (TOTP alanı YOK)
- Submit → `bootstrapLogin()` çağrısı
- Başarı → auth store'a `setSession()`, redirect `/admin/users`
- Hata → toast mesajı
- Sayfa üstünde turuncu uyarı banner: "Bootstrap Modu — Sadece acil erişim için kullanın"

---

### 8 — Frontend: Route ekle

**Dosya:** `web/src/App.tsx`

Mevcut route'ların yanına:
```tsx
<Route path="/admin-setup" element={<AdminSetupPage />} />
```

Bu route `AuthGate` dışında kalır (zaten oturum açılmamış durumda erişilecek).

---

### 9 — Frontend: Bootstrap banner (AppShell)

**Dosya:** `web/src/components/layout/app-shell.tsx`

Auth store'dan `isBootstrapSession` flag'ini oku (veya token'ı decode ederek `via`
claim'ine bak). Banner koşulu:

```tsx
{isBootstrapSession && (
  <div className="bg-amber-500 text-black text-sm text-center py-1 px-4">
    ⚠ Bootstrap Modu — TOTP atlanarak giriş yapıldı. İşiniz bittikten sonra çıkış yapın.
  </div>
)}
```

---

### 10 — Testler

**Server:**
- `auth_bootstrap_test.go`: bootstrap disabled → 503, şifre yanlış → 401,
  admin değil → 401, disabled hesap → 403, başarılı → 200 + JWT
- Birim test sayısı: ~6 yeni test case

**Frontend:**
- `admin-setup.test.tsx`: form render, submit, başarı redirect, hata toast
- ~4 yeni test case

---

## Dosya Değişim Özeti

| Dosya | Değişiklik |
|-------|-----------|
| `server/internal/config/config.go` | `BootstrapEnabled bool` |
| `server/internal/audit/audit.go` | `ActionAuthBootstrapLogin` sabiti |
| `server/internal/httpapi/auth_handlers.go` | `BootstrapEnabled bool` alanı |
| `server/internal/httpapi/auth_bootstrap.go` | **YENİ** — handler + parseBasicAuth |
| `server/internal/httpapi/auth_bootstrap_test.go` | **YENİ** — ~6 test |
| `server/internal/httpapi/router.go` | bootstrap endpoint mount |
| `server/cmd/api/main.go` | `BootstrapEnabled` wire |
| `web/src/api/bootstrap.ts` | **YENİ** — API helper |
| `web/src/pages/admin-setup.tsx` | **YENİ** — login form |
| `web/src/App.tsx` | `/admin-setup` route |
| `web/src/components/layout/app-shell.tsx` | bootstrap banner |

---

## Environment Variables

```bash
# Bootstrap panelini aktif et (default: false)
ENVANTER_BOOTSTRAP_ENABLED=true

# k8s için (sealed secret güncelle, rolling restart):
# kubectl patch sealedsecret envanter-secret --type='json' \
#   -p '[{"op":"replace","path":"/spec/encryptedData/ENVANTER_BOOTSTRAP_ENABLED","value":"<sealed>"}]'
```

---

## Ops Kullanım Senaryosu

```
1. kubectl set env deployment/envanter-api ENVANTER_BOOTSTRAP_ENABLED=true
2. Tarayıcıda: https://envanter.example.com/admin-setup
3. Admin kullanıcı adı + şifre gir (TOTP gerekmez)
4. /admin/users sayfasında:
   - Yeni kullanıcılara admin/write/read rolleri ver
   - pending_totp durumundaki admin'lerin TOTP kurulumunu tamamlamasını sağla
   - Kilitli hesapları aç
5. İşlem bitti → Çıkış yap
6. kubectl set env deployment/envanter-api ENVANTER_BOOTSTRAP_ENABLED=false
```

---

## PR Bilgileri

- **Branch:** `feat/bootstrap-admin`
- **Base:** `main`
- **Etiket:** `feat`, `security`, `ops`
- **Öncelik:** Yüksek (aktif kilitlenme var)
