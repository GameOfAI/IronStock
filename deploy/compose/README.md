# Dev Compose Stack

Lokal geliştirme için shared dev servisleri.

## Servisler

| Servis | Port | Amaç | Erişim |
|--------|------|------|--------|
| `postgres` | 5432 | Ana veritabanı (Postgres 16) | `postgres://envanter:envanter_dev@localhost:5432/envanter` |
| `adminer` | 8081 | DB admin UI | http://localhost:8081 |
| `mailhog` | 1025 (SMTP) / 8025 (UI) | Mail capture (şifre sıfırlama vs için, Faz 2+) | http://localhost:8025 |

## Komutlar

```bash
make up      # başlat (-d)
make ps      # durum
make logs    # log follow
make down    # durdur (volume korunur)
```

Volume'leri de silmek için (verileri sıfırla):
```bash
docker compose -f deploy/compose/docker-compose.yml down -v
```

## Notlar

- Credentials sadece **dev** için — üretimde asla kullanılmaz.
- Postgres verisi `postgres_data` named volume'unda. Host'ta `/var/lib/docker/volumes/envanter-dev_postgres_data/`.
- Mailhog Faz 2+ eklenecek password reset flow'u için hazır bekliyor.
