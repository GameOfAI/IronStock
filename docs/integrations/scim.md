# SCIM 2.0 Entegrasyonu

IronStock, SCIM 2.0 protokolünü destekler. Identity provider'lar (Okta, Azure AD, OneLogin, vb.) ile otomatik kullanıcı provisioning/deprovisioning yapılabilir.

## Endpoint

```
Base URL: https://<ironstock-host>/scim/v2
```

## Kimlik Doğrulama

SCIM endpoint'leri Bearer token ile korunur. API token oluştururken `scim` scope'u seçilmelidir.

```bash
curl -H "Authorization: Bearer ist_..." \
  https://ironstock.example.com/scim/v2/Users
```

## Desteklenen İşlemler

### Kullanıcılar

| İşlem | Method | Path |
|-------|--------|------|
| Listele | `GET` | `/scim/v2/Users` |
| Oluştur | `POST` | `/scim/v2/Users` |
| Oku | `GET` | `/scim/v2/Users/{id}` |
| Sil | `DELETE` | `/scim/v2/Users/{id}` |

### Gruplar

| İşlem | Method | Path |
|-------|--------|------|
| Listele | `GET` | `/scim/v2/Groups` |
| Oluştur | `POST` | `/scim/v2/Groups` |
| Oku | `GET` | `/scim/v2/Groups/{id}` |

## Okta Yapılandırması

1. Okta Admin → Applications → Create App Integration
2. SCIM (SCIM 2.0 Test App) seçin
3. Provisioning sekmesinde:
   - SCIM connector base URL: `https://ironstock.example.com/scim/v2`
   - Authentication mode: HTTP Header
   - Authorization: `Bearer ist_...`
4. Supported provisioning actions: Push New Users, Push Profile Updates, Push Groups

## Azure AD Yapılandırması

1. Azure Portal → Enterprise Applications → New Application
2. Non-gallery application oluşturun
3. Provisioning → Automatic
   - Tenant URL: `https://ironstock.example.com/scim/v2`
   - Secret Token: `ist_...`
4. Test Connection → Start Provisioning

## Kullanıcı Mapping

| SCIM Attribute | IronStock Alanı |
|---------------|----------------|
| `userName` | `username` |
| `emails[0].value` | `email` |
| `displayName` | `display_name` |
| `active` | `status` (active/disabled) |
| `externalId` | `external_id` (SCIM referansı) |
