# HashiCorp Vault Entegrasyonu

IronStock, HashiCorp Vault'u harici secret backend olarak kullanabilir. Vault'taki statik secret'lar proxy ile okunabilir, dinamik credential'lar (database, AWS, vb.) talep üzerine üretilebilir.

## Yapılandırma

```bash
export ENVANTER_VAULT_ADDR=https://vault.cluster.local:8200
export ENVANTER_VAULT_ROLE_ID=<appole-role-id>
export ENVANTER_VAULT_SECRET_ID=<approle-secret-id>
export ENVANTER_VAULT_NAMESPACE=ironstock  # Vault Enterprise (opsiyonel)
```

## Vault AppRole Kurulumu

```bash
# IronStock policy oluştur
vault policy write ironstock - <<EOF
path "secret/data/ironstock/*" {
  capabilities = ["read"]
}
path "database/creds/*" {
  capabilities = ["read"]
}
path "sys/leases/revoke" {
  capabilities = ["update"]
}
EOF

# AppRole etkinleştir ve rol oluştur
vault auth enable approle
vault write auth/approle/role/ironstock \
  token_policies="ironstock" \
  secret_id_ttl=0 \
  token_ttl=1h \
  token_max_ttl=4h

# Credentials al
vault read auth/approle/role/ironstock/role-id
vault write -f auth/approle/role/ironstock/secret-id
```

## Statik Secret Okuma

Item'a Vault kaynak bilgisi eklendikten sonra:

```
POST /api/v1/items/{id}/vault-fetch
```

IronStock, Vault'tan secret'ı çeker ve E2E şifreli olarak istemciye döndürür.

## Dinamik Credential'lar

Vault dynamic secret engine'leri (database, AWS, vb.) desteklenir:

```
# Dinamik credential üret
POST /api/v1/items/{id}/dynamic-cred

# Lease iptal et
DELETE /api/v1/items/{id}/dynamic-cred
```

### Web UI Davranışı

- "Al" butonu: yeni credential üretir, 30 saniye sonra otomatik temizlenir
- Countdown timer: lease TTL'ini gösterir
- "İptal Et": lease'i Vault'ta revoke eder
- Gizle/göster: credential değerlerini maskelemek için

## Desteklenen Engine'ler

| Engine | Kullanım |
|--------|----------|
| KV v2 | Statik secret okuma |
| Database | Dinamik DB credential üretimi |
| AWS | Dinamik AWS IAM credential üretimi |
| PKI | Sertifika üretimi |

## Güvenlik Notları

- IronStock, Vault token'ını bellekte tutar (disk'e yazmaz)
- AppRole secret_id döndürülebilir (secret_id_ttl)
- Minimum yetki prensibi: sadece gerekli path'lere erişim verin
- Dynamic credential'lar kullanım sonrası otomatik revoke edilebilir
