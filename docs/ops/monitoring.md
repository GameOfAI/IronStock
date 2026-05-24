# IronStock Monitoring Kılavuzu

## Prometheus Metrikleri

IronStock `GET /metrics` endpoint'i üzerinden Prometheus metrikleri sunar. Erişim ağ katmanında (NetworkPolicy) kısıtlanmalıdır.

### Mevcut Metrikler

| Metrik | Tip | Açıklama |
|--------|-----|----------|
| `envanter_http_requests_total` | Counter | HTTP istek sayısı (method, route, status) |
| `envanter_http_request_duration_seconds` | Histogram | HTTP istek süresi (method, route) |
| `envanter_auth_failures_total` | Counter | Kimlik doğrulama hataları (reason) |
| `envanter_item_ops_total` | Counter | Item CRUD işlemleri (op) |
| `ironstock_credentials_expiring_total` | Gauge | Süresi dolacak credential'lar (within: 7d/30d) |
| `ironstock_credentials_expired_total` | Gauge | Süresi dolmuş credential'lar |
| `ironstock_items_unhealthy_total` | Gauge | Sağlıksız item'lar (severity: high/medium) |
| `ironstock_breakglass_logins_total` | Counter | Break-glass acil giriş sayısı |
| `ironstock_auth_failures_total` | Counter | Auth hataları (alert kuralları için alias) |

### Histogram Bucket'ları

`envanter_http_request_duration_seconds` varsayılan Prometheus bucket'larını kullanır:
`.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10`

### Ölçülmeyen Endpoint'ler

`/healthz`, `/readyz` ve `/metrics` endpoint'leri metrik toplamadan hariç tutulur (yüksek frekanslı probe gürültüsünü önlemek için).

## Grafana Dashboard

### Genel Bakış Paneli

```promql
# İstek oranı (son 5 dakika)
sum(rate(envanter_http_requests_total[5m]))

# Hata oranı
sum(rate(envanter_http_requests_total{status=~"5.."}[5m]))
/
sum(rate(envanter_http_requests_total[5m]))

# p95 latency
histogram_quantile(0.95,
  rate(envanter_http_request_duration_seconds_bucket[5m])
)
```

### Güvenlik Paneli

```promql
# Auth hata oranı (reason bazında)
sum by (reason) (rate(ironstock_auth_failures_total[5m]))

# Break-glass giriş olayları
increase(ironstock_breakglass_logins_total[1h])

# Süresi dolmak üzere olan credential'lar
ironstock_credentials_expiring_total{within="7d"}
```

### Kapasite Paneli

```promql
# DB bağlantı havuzu kullanımı (pgx metrikleri)
# İstek başına ortalama süre (route bazında)
topk(10,
  avg by (route) (rate(envanter_http_request_duration_seconds_sum[5m])
  /
  rate(envanter_http_request_duration_seconds_count[5m]))
)
```

## Alerting

SLO alert kuralları için bkz. [slo.md](slo.md).

### Kritik Alertler

| Alert | Koşul | Severity |
|-------|--------|----------|
| HighErrorRate | 5xx oranı > %0.1, 5dk | critical |
| HighLatencyP99 | p99 > 500ms, 5dk | critical |
| BreakGlassLogin | break-glass login > 0, anlık | critical |
| CredentialsExpired | expired credential > 0 | warning |

## pg_stat_statements

N+1 sorgu tespiti ve yavaş sorgu analizi için:

```sql
-- En yavaş 10 sorgu
SELECT query, calls, mean_exec_time::numeric(10,2) AS avg_ms
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- En çok çağrılan 10 sorgu (N+1 şüphesi)
SELECT query, calls, mean_exec_time::numeric(10,2) AS avg_ms
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 10;

-- İstatistikleri sıfırla
SELECT pg_stat_statements_reset();
```

## pprof Profiling

`ENVANTER_PPROF_ENABLED=true` ayarlandığında `/debug/pprof/` endpoint'leri aktifleşir.

```bash
# 30 saniyelik CPU profili
go tool pprof http://localhost:8080/debug/pprof/profile?seconds=30

# Heap bellek profili
go tool pprof http://localhost:8080/debug/pprof/heap

# Goroutine dökümü
curl http://localhost:8080/debug/pprof/goroutine?debug=2

# Execution trace (5 saniye)
curl -o trace.out http://localhost:8080/debug/pprof/trace?seconds=5
go tool trace trace.out
```

**Uyarı:** pprof production'da varsayılan olarak kapalıdır. Yalnızca sorun giderme sırasında geçici olarak açın ve NetworkPolicy ile erişimi kısıtlayın.

## Log Formatı

IronStock yapılandırılmış JSON log'lar üretir (`ENVANTER_LOG_FORMAT=json`):

```json
{
  "time": "2026-01-15T10:30:00Z",
  "level": "INFO",
  "msg": "envanter-api starting",
  "addr": ":8080",
  "log_level": "info"
}
```

### Log Yönlendirme

Admin panelinden log yönlendirme hedefleri yapılandırılabilir:
- **Syslog** (RFC 5424)
- **Splunk** (HEC)
- **Elastic** (ECS format, Bulk API)

Yönetim: `GET/POST/PUT/DELETE /api/v1/admin/log-forwarding`
