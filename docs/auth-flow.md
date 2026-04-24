# Authentication & Authorization — Akış Dokümantasyonu

Bu belge kimlik doğrulama ve yetkilendirme akışlarını kullanıcı-seviyesinde anlatır. Kripto detayları için → [ADR-0004](adr/0004-encryption-details.md). Güvenlik modeli özeti için → [ADR-0002](adr/0002-security-model.md).

## Kararlar (Özet)

| Karar | Seçim |
|-------|-------|
| Şifre hash | Argon2id (t=3, m=64MiB, p=4) |
| MFA | TOTP (RFC 6238), kayıt tamamlanması **zorunlu** — setup bitmeden login açılmaz |
| Session token | JWT access (15dk) + opaque refresh (7g, rotating) |
| Refresh rotation | Kullanımda yeni token üretilir, eskisi revoke |
| E2E keypair | X25519, kullanıcının master password'undan türeyen KEK ile korunan private key |
| Recovery | 10 adet 16-haneli kod (Argon2id hash'li saklanır), **yeniden erişim için, solo item kurtarma için değil** |
| Auto-lock | Client 10dk idle default (5/10/15/30dk configurable). KEK + priv RAM'den silinir; session token'lar durur → sadece master password ile unlock |
| Session binding | UA/IP değişimi **flag** (audit log + opsiyonel bildirim), block değil. Refresh token reuse → tüm session'lar revoke |
| Rate limit | `/login`, `/totp/verify`, `/recover`: kullanıcı başına 5 deneme / 15dk |

## Senaryolar

### 1. Kayıt (Register)

Kayıt, TOTP kurulumu tamamlanmadan **login yapılamayacak** bir taslak state'te biter — admin sonradan hesabı activate eder veya kullanıcı TOTP'yi tamamlar.

```mermaid
sequenceDiagram
    autonumber
    actor U as Kullanıcı (Client)
    participant S as Server
    participant DB as Postgres

    U->>U: Master password gir
    U->>U: kek_salt=random(16)<br/>KEK=Argon2id(pw, kek_salt)<br/>(pub, priv)=X25519_keypair()<br/>priv_enc=AES-GCM(priv, KEK)
    U->>S: POST /auth/register<br/>{username, email, master_password,<br/>public_key, private_key_enc,<br/>kek_salt, kek_params}
    S->>S: Argon2id(master_password, server_salt) = password_hash
    S->>DB: INSERT users (status='pending_totp')
    S->>DB: INSERT user_keypairs (pub, priv_enc, kek_salt, kek_params)
    S-->>U: 201 Created<br/>{user_id, totp_enrollment_url}
    Note over U: Ayrı flow: TOTP enrollment (Senaryo 2)
    S->>S: master_password'u RAM'den sil
```

**Önemli:**
- `master_password` **TLS içinden ham olarak** gönderilir. Server Argon2id hash'ler ve orijinali siler.
- `password_hash` ve `KEK` **farklı salt'larla** türetilir — biri server DB'de, diğeri client'ta KEK türetimi için.
- `users.status = 'pending_totp'`: login denemesi bu statüde iken rejected. TOTP kurulunca `active`.

### 2. TOTP Enrollment (2FA Setup)

Register sonrası zorunlu adım. Kullanıcı QR kod tarar, ilk kodu girer.

```mermaid
sequenceDiagram
    autonumber
    actor U as Kullanıcı
    participant S as Server
    participant DB

    U->>S: POST /auth/totp/init (tmp_session veya bearer)
    S->>S: secret=random(20B)<br/>URI=otpauth://totp/Envanter:username?secret=BASE32&issuer=Envanter
    S->>DB: INSERT totp_secrets<br/>(secret_enc=envelope(secret, master_key), verified=false)
    S-->>U: {secret_uri, qr_png_data_url, backup_code}
    U->>U: Authenticator uygulamasında QR tara
    U->>S: POST /auth/totp/verify {code}
    S->>DB: totp_secrets.secret_enc decrypt → secret
    S->>S: TOTP.Verify(secret, code, window=1) == true?
    alt kod doğru
        S->>DB: UPDATE totp_secrets SET verified=true<br/>UPDATE users SET status='active'
        S->>DB: INSERT recovery_codes (10 adet, Argon2id-hashed)
        S-->>U: 200 OK {recovery_codes: [10 x plaintext]}
        Note over U: Kullanıcı bu 10 kodu güvenli yere kaydetmeli<br/>(bir daha gösterilmez)
    else kod yanlış
        S-->>U: 400 invalid_code
    end
```

**Dikkat:**
- TOTP secret (20B) server-side envelope encrypted → server kullanır ama DB-at-rest'te şifreli.
- Recovery code'lar **bir kere** döner. Kaydetmezse kullanıcı kaybeder.

### 3. Login

Tek adımda 3 doğrulama: password + TOTP + E2E key unwrap.

```mermaid
sequenceDiagram
    autonumber
    actor U as Kullanıcı
    participant S as Server
    participant DB

    U->>S: POST /auth/login<br/>{username, master_password, totp_code}
    S->>DB: SELECT password_hash, argon2_params FROM users WHERE username=?
    S->>S: Argon2id.Verify(password_hash, master_password)
    alt hash yanlış
        S->>DB: INSERT audit_log (auth.fail)<br/>UPDATE users failed_login_attempts++
        S-->>U: 401 invalid_credentials
    else hash doğru
        S->>DB: SELECT secret_enc FROM totp_secrets WHERE user_id=?
        S->>S: envelope_decrypt(secret_enc, master_key)<br/>TOTP.Verify(secret, totp_code, window=1)
        alt TOTP yanlış
            S-->>U: 401 invalid_mfa
        else TOTP doğru
            S->>S: access_token = JWT{sub:user_id, roles, exp:+15m}<br/>refresh_token = opaque(32B)
            S->>DB: INSERT sessions (user_id, refresh_token_hash=SHA256(rt), expires_at=+7d)
            S->>DB: INSERT audit_log (auth.login)
            S->>DB: SELECT public_key, private_key_enc, kek_salt, kek_params FROM user_keypairs
            S-->>U: 200 OK<br/>{access_token, refresh_token, user:{id, roles},<br/>keypair:{pub, priv_enc, kek_salt, kek_params}}
        end
    end
    Note over U: Client tarafında:
    U->>U: KEK = Argon2id(master_password, kek_salt)
    U->>U: priv = AES-GCM-decrypt(priv_enc, KEK)
    U->>U: master_password'u RAM'den sil<br/>vault = {KEK, priv, access_token, refresh_token}
```

### 4. Access Token Refresh

Access token 15dk sonra expire olur. Refresh rotation: kullanılan refresh **tek kullanımlık**.

```mermaid
sequenceDiagram
    autonumber
    actor U as Client
    participant S as Server
    participant DB

    U->>S: POST /auth/refresh {refresh_token}
    S->>DB: SELECT * FROM sessions<br/>WHERE refresh_token_hash=SHA256(rt)<br/>AND revoked_at IS NULL AND expires_at>now()
    alt session geçerli
        S->>DB: UPDATE sessions SET revoked_at=now(), revoke_reason='rotation'
        S->>S: yeni access + yeni refresh üret
        S->>DB: INSERT sessions (new refresh_token_hash)
        S-->>U: 200 {access_token, refresh_token}
    else geçersiz
        S->>DB: INSERT audit_log (auth.refresh_fail)
        Note over S: Reuse detection! Önceki session zaten revoke'luysa<br/>tüm user session'larını revoke et (token theft şüphesi)
        S-->>U: 401 invalid_refresh
    end
```

**Kritik:** Aynı refresh token iki kez kullanılmaya çalışılırsa, token çalındı demektir. Tüm session'lar revoke edilir (user force re-login).

### 5. Auto-Lock (Client Idle)

```mermaid
sequenceDiagram
    actor U as Client (Tauri)
    participant T as Timer
    
    U->>T: start idle timer (10dk default)
    Note over U: kullanıcı etkinliği yok
    T-->>U: timeout
    U->>U: vault.KEK = zeroize<br/>vault.priv = zeroize<br/>UI = lock screen
    Note over U: Kullanıcı yeniden master password girerse:
    U->>U: KEK = Argon2id(pw, kek_salt)<br/>priv = AES-GCM-decrypt(priv_enc, KEK)<br/>Unlock UI
```

**Not:**
- `access_token` ve `refresh_token` auto-lock'ta **silinmez** — bir sonraki API call için lazım (background sync).
- `KEK` ve `priv` **silinir** — secret field decrypt edemez hale gelir.

### 6. Logout

İki varyant:

```mermaid
sequenceDiagram
    actor U as Client
    participant S as Server
    participant DB

    U->>S: POST /auth/logout (tek session)
    S->>DB: UPDATE sessions SET revoked_at=now(), revoke_reason='logout'<br/>WHERE id=current_session
    S-->>U: 204

    U->>S: POST /auth/logout-all (tüm session'lar)
    S->>DB: UPDATE sessions SET revoked_at=now(), revoke_reason='logout_all'<br/>WHERE user_id=? AND revoked_at IS NULL
    S-->>U: 204
    Note over U: Client vault'u temizler (KEK, priv, tokens)
```

### 7. Master Password Değiştirme (Biliniyor)

Mevcut password bilindiği için E2E priv key korunur — sadece KEK ve `private_key_enc` yeniden üretilir.

```mermaid
sequenceDiagram
    actor U as Client
    participant S as Server
    participant DB

    U->>U: KEK_old = Argon2id(old_pw, old_kek_salt)<br/>priv = AES-GCM-decrypt(priv_enc, KEK_old)<br/>
    U->>U: new_kek_salt = random(16)<br/>KEK_new = Argon2id(new_pw, new_kek_salt)<br/>new_priv_enc = AES-GCM(priv, KEK_new)
    U->>S: POST /auth/change-password<br/>{old_password, new_password,<br/>new_kek_salt, new_kek_params, new_priv_enc}
    S->>S: Argon2id.Verify(password_hash, old_password)
    alt doğru
        S->>S: new_hash = Argon2id(new_password, new_server_salt)
        S->>DB: UPDATE users SET password_hash=?<br/>UPDATE user_keypairs SET kek_salt=?, private_key_enc=?
        S->>DB: INSERT audit_log (auth.password_changed)
        S-->>U: 204
    else yanlış
        S-->>U: 401
    end
```

**Kritik:** `priv` korunduğu için kullanıcı tüm item_shares'i açmaya devam eder. **Veri kaybı yok.**

### 8. Master Password Recovery (Unutulmuş)

Kullanıcı password'u unuttu → recovery code ile girer → **yeni keypair** üretir → solo item'ları kaybeder.

```mermaid
sequenceDiagram
    actor U as Client
    participant S as Server
    participant DB

    U->>S: POST /auth/recover/init<br/>{username, recovery_code}
    S->>DB: SELECT code_hash FROM recovery_codes<br/>WHERE user_id=? AND used_at IS NULL
    S->>S: Argon2id.Verify(code_hash, recovery_code)
    alt doğru
        S->>DB: UPDATE recovery_codes SET used_at=now()
        S->>S: tmp_token = JWT{purpose:recovery, exp:+15m, one_time}
        S-->>U: 200 {tmp_token}
    else yanlış
        S->>DB: INSERT audit_log (auth.recover_fail)
        S-->>U: 401
    end
    
    Note over U: Kullanıcı yeni master password belirler:
    U->>U: new_kek_salt = random(16)<br/>KEK_new = Argon2id(new_pw, new_kek_salt)<br/>(new_pub, new_priv) = X25519_keypair()<br/>new_priv_enc = AES-GCM(new_priv, KEK_new)

    U->>S: POST /auth/recover/complete (Bearer tmp_token)<br/>{new_password, new_kek_salt, new_kek_params,<br/>new_public_key, new_priv_enc}
    S->>S: Argon2id(new_password, server_salt) = new_hash
    S->>DB: UPDATE users SET password_hash=?<br/>UPDATE user_keypairs SET public_key=?, kek_salt=?,<br/>private_key_enc=?, rotated_at=now()
    S->>DB: UPDATE sessions SET revoked_at=now(), revoke_reason='recovery'<br/>WHERE user_id=?
    S->>DB: INSERT audit_log (auth.recovered)
    S-->>U: 204
    Note over U: Kullanıcı yeniden login olmalı
```

**Sonuç:**
- Eski `user_keypairs.public_key` değişti → item_shares'teki wrapped DEK'lere eski priv ile artık erişim yok.
- **Solo item'lar** (sadece bu user'ın paylaştığı) → kaybedildi. DB'de duruyor ama okunamıyor (admin bile açamaz).
- **Paylaşımlı item'lar**: Diğer sahipler kullanıcıyı yeniden item'a ekleyerek erişimi geri verebilir (yeni public_key ile wrap).
- UI'da **prominent uyarı**: "Recovery yeniden girişinizi sağlar, ama solo kayıtlarınız kaybolacak."

### 9. Admin User Reset (Nükleer Seçenek)

Kullanıcı master password + recovery code **ikisini de** kaybettiyse: admin hesabı reset edebilir. Kullanıcının **tüm verileri kaybolur** (yeni keypair ile başlar).

```mermaid
sequenceDiagram
    actor A as Admin
    participant S as Server
    participant DB
    actor U as Kullanıcı

    A->>S: POST /admin/users/:id/reset (admin role)
    S->>DB: UPDATE user_keypairs SET rotated_at=now() (eski keypair history'de kalır)
    S->>DB: DELETE FROM item_shares WHERE user_id=?
    S->>DB: DELETE FROM items WHERE created_by=? AND NOT EXISTS (SELECT 1 FROM item_shares WHERE item_id=items.id)
    Note over S: Solo item'lar tamamen silinir (kimse açamaz)
    S->>DB: UPDATE users SET status='pending_totp', password_hash=?<br/>(yeni geçici password)
    S->>DB: INSERT audit_log (auth.admin_reset)
    S-->>A: 200 {temporary_password}
    A->>U: Geçici password'u güvenli kanaldan ilet
    Note over U: User login eder, register benzeri TOTP+keypair setup yapar
```

## RBAC — 3 Katmanlı Yetkilendirme

Detay: [ADR-0006](adr/0006-data-model-extensions.md) §3-4.

### Katmanlar

```
1. Global rol           (users ↔ roles)          admin | write | read
2. Klasör-level ACL     (folder_permissions)     user×folder → read|write, inherit
3. Item-level share     (item_shares)            user×item → read|write
```

### Effective Permission Hesabı

```python
def can_access(user, item, required='read') -> bool:
    # 1. admin her şeye erişir
    if 'admin' in user.global_roles: return True

    # 2. Item-level share (en spesifik)
    if item_shares.has(user, item, required): return True

    # 3. Folder-level ACL (en yakın ancestor folder'ın inherit izni)
    for folder in item.folder.ancestors_including_self():
        perm = folder_permissions.get(user, folder)
        if perm and perm.inherit_to_children and perm.permission >= required:
            return True

    # 4. Global role (salt okuma için fallback, yazma asla global değil)
    if required == 'read' and 'read' in user.global_roles:
        return False  # okuma yine de explicit share/folder perm istiyor — güvenli default
    return False
```

**Not:** Global `read` rolü "tüm envantere okuma" demez — sadece login yapabilme + explicit izin verilen kaynakları görme. Global `write` rolü item/folder oluşturma yetkisi verir, ama neyi görüp düzenleyebileceği folder/item izinlerine bağlıdır.

### Endpoint Matrix (özet)

| Endpoint | admin | write | read | public |
|----------|-------|-------|------|--------|
| `POST /auth/register` | — | — | — | ✓ (veya admin-invited, Faz 2 karar) |
| `POST /auth/login` | ✓ | ✓ | ✓ | ✓ |
| `GET /items`, `GET /folders` | ✓ (hepsi) | ✓ (yetkili) | ✓ (yetkili) | — |
| `POST /items`, `POST /folders` | ✓ | ✓ (yetkili folder'da) | — | — |
| `PUT /items/:id` | ✓ | ✓ (owner, write share, write folder ACL) | — | — |
| `DELETE /items/:id` | ✓ | ✓ (owner) | — | — |
| `POST /items/:id/shares` | ✓ | ✓ (owner) | — | — |
| `POST /folders/:id/permissions` | ✓ | ✓ (owner veya folder write) | — | — |
| `POST /admin/users` | ✓ | — | — | — |
| `GET /admin/audit` | ✓ | — | — | — |
| `POST /field-definitions`, `POST /item-types` | ✓ | — | — | — |

### Örnek Senaryolar

- **DBA (global write):** ProjeA klasörüne `write` folder perm ile grant'lı. ProjeB'ye yok. ProjeA içindeki tüm item'ları görür/düzenler; ProjeB'den bile bahsedilmez (klasör listesinde görünmez).
- **Audit personeli (global read):** Hiçbir klasöre perm yok, hiçbir item share yok. Sadece `/admin/audit` okuyabilir (admin değil, ama audit-specific rol gelirse — ileride Faz 5).
- **Geliştirici (global write, sadece Test klasörü):** /ProjeA/Test folder perm=write + inherit. Test altındaki tüm item'ları oluşturup silebilir. Prod altına bakamaz.
- **Admin:** Her şeyi görür. Sadece admin kendi field_definitions / item_types oluşturabilir.

## Güvenlik Kısıtları (Genel)

- **Rate limit:** `/login`, `/totp/verify`, `/recover/init`, `/refresh` — kullanıcı başına 5 deneme / 15dk. IP başına global 100/dk.
- **Account lockout:** 10 başarısız login → 30dk lock (`users.locked_until`). Admin manuel unlock.
- **Session binding:** Refresh token + User-Agent + IP birlikte kaydedilir. Ağırlıklı UA/IP değişimi → suspicious flag (logged, blocked değil — mobile/VPN için).
- **Token storage (client):**
  - access_token → RAM only
  - refresh_token → Tauri: OS secure storage (Keychain / DPAPI). Web: HttpOnly secure SameSite=Strict cookie
  - KEK + priv → RAM only, auto-zeroize on lock
- **TLS:** Production'da HTTP redirect zorunlu.
- **Audit:** Her auth event audit_log'da (success + fail).

## Error Codes (OpenAPI v1 için referans)

| Kod | Mesaj | Kullanım |
|-----|-------|----------|
| `invalid_credentials` | Kullanıcı adı veya parola hatalı | login password verify fail |
| `invalid_mfa` | TOTP kodu geçersiz | login TOTP fail |
| `account_locked` | Çok fazla deneme, hesap kilitli | account lockout aktif |
| `account_pending_totp` | TOTP kurulumu tamamlanmadı | login ama status=pending_totp |
| `invalid_recovery_code` | Kurtarma kodu geçersiz | recovery/init fail |
| `invalid_refresh` | Refresh token geçersiz / kullanılmış | refresh fail |
| `token_reuse_detected` | Tekrar kullanım tespit edildi | refresh token reuse — hepsi revoke |
| `rate_limited` | Çok fazla istek, bekleyin | rate limit |

## Client Implementation Notları (Faz 4)

- **Tauri'de priv + KEK saklama:** Rust tarafında `zeroize` crate ile `Drop` sırasında explicit zero. Memory dump'larda sızmaması için.
- **UI auto-lock timer:** DOM event listener'ları (click, keypress) reset timer. Son event'ten 5dk sonra trigger.
- **OS lock/sleep integration:** Ekran kilitlenirse → anında auto-lock. Tauri'de `window.on_event(FocusLost)` değil, OS API gerekli (faz 4 detay).

## Faz Sorumlulukları

| Faz | İş |
|-----|-----|
| **Faz 2** | Server: `/auth/*` endpoint'ler, Argon2id + TOTP + JWT, session store |
| **Faz 2** | Rate limit middleware, account lockout |
| **Faz 3** | Web UI: login + MFA sayfaları (server session kullanır, E2E yok web'de) |
| **Faz 4** | Client: register + login + KEK derive + auto-lock + recovery UI |
