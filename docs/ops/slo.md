# IronStock SLO Hedefleri

Son güncelleme: 2026-05-24

## Genel Bakış

Bu döküman IronStock credential vault uygulamasının Service Level Objectives (SLO) hedeflerini tanımlar. Prometheus metrikleri (`envanter_http_request_duration_seconds`, `envanter_http_requests_total`) ile izlenir.

## Kullanılabilirlik

| SLO | Hedef | Ölçüm |
|-----|--------|-------|
| API Kullanılabilirliği | ≥ 99.9% (aylık) | `1 - (5xx yanıtlar / toplam istek)` |
| Planlı bakım hariç downtime | ≤ 43 dakika / ay | Prometheus up metriği |

## Yanıt Süresi (Latency)

| Endpoint Grubu | p50 | p95 | p99 |
|----------------|-----|-----|-----|
| REST API (CRUD) | < 50ms | < 200ms | < 500ms |
| Arama (full-text + trigram) | < 100ms | < 300ms | < 1s |
| WebSocket bağlantı kurulumu | < 50ms | < 100ms | < 200ms |
| Login (Argon2 + TOTP doğrulama) | < 500ms | < 1s | < 2s |
| Rapor oluşturma (K8s HTML) | < 2s | < 5s | < 10s |
| Şifreli bulk export (ZIP) | < 5s | < 15s | < 30s |

### Prometheus Sorguları

```promql
# p95 REST API latency (son 5 dakika)
histogram_quantile(0.95,
  rate(envanter_http_request_duration_seconds_bucket[5m])
)

# p99 login latency
histogram_quantile(0.99,
  rate(envanter_http_request_duration_seconds_bucket{route=~"/api/v1/auth/login.*"}[5m])
)

# Kullanılabilirlik (son 30 gün)
1 - (
  sum(rate(envanter_http_requests_total{status=~"5.."}[30d]))
  /
  sum(rate(envanter_http_requests_total[30d]))
)
```

## WebSocket

| SLO | Hedef |
|-----|--------|
| Eşzamanlı bağlantı kapasitesi | ≥ 1000 bağlantı / pod |
| Mesaj teslim gecikmesi (fan-out) | < 100ms (p99) |
| Bağlantı kopma oranı | < 0.1% / saat |

## Veritabanı

| SLO | Hedef |
|-----|--------|
| Sorgu süresi (p95) | < 50ms |
| Connection pool kullanımı | < 80% |
| N+1 sorgu sayısı | 0 (pg_stat_statements ile izlenir) |

### pg_stat_statements İzleme

```sql
-- En yavaş 10 sorgu (ortalama süre)
SELECT query,
       calls,
       mean_exec_time::numeric(10,2) AS avg_ms,
       total_exec_time::numeric(10,2) AS total_ms
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 50ms üzeri sorgular (SLO ihlali)
SELECT query, calls, mean_exec_time::numeric(10,2) AS avg_ms
FROM pg_stat_statements
WHERE mean_exec_time > 50
ORDER BY mean_exec_time DESC;
```

## Hata Bütçesi

| Pencere | İzin Verilen Downtime (99.9%) |
|---------|-------------------------------|
| 30 gün  | 43 dakika 12 saniye           |
| 7 gün   | 10 dakika 5 saniye            |
| 1 gün   | 1 dakika 26 saniye            |

## Alert Kuralları

SLO ihlalleri için önerilen Prometheus alert kuralları:

```yaml
groups:
  - name: ironstock-slo
    rules:
      - alert: HighLatencyP95
        expr: |
          histogram_quantile(0.95,
            rate(envanter_http_request_duration_seconds_bucket[5m])
          ) > 0.2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API p95 latency SLO ihlali (> 200ms)"

      - alert: HighLatencyP99
        expr: |
          histogram_quantile(0.99,
            rate(envanter_http_request_duration_seconds_bucket[5m])
          ) > 0.5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API p99 latency SLO ihlali (> 500ms)"

      - alert: HighErrorRate
        expr: |
          sum(rate(envanter_http_requests_total{status=~"5.."}[5m]))
          /
          sum(rate(envanter_http_requests_total[5m]))
          > 0.001
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Hata oranı SLO ihlali (> 0.1%)"

      - alert: LoginLatencyHigh
        expr: |
          histogram_quantile(0.95,
            rate(envanter_http_request_duration_seconds_bucket{route="/api/v1/auth/login"}[5m])
          ) > 1.0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Login p95 latency > 1s"
```

## Kapasite Planlaması

| Kaynak | Hedef | İzleme |
|--------|--------|--------|
| CPU kullanımı (pod) | < 70% (p95) | container_cpu_usage_seconds_total |
| Bellek kullanımı (pod) | < 80% | container_memory_working_set_bytes |
| DB connection pool | < 80% dolu | pgx pool metrikleri |
| Disk I/O (MinIO) | < 50MB/s yazma | node_disk_written_bytes_total |

## Gözden Geçirme

- SLO hedefleri her çeyrek gözden geçirilir
- Hata bütçesi tükendiğinde yeni feature geliştirme durdurulur, güvenilirlik çalışmasına odaklanılır
- pprof profilleme (`/debug/pprof/`) ENVANTER_PPROF_ENABLED=true ile etkinleştirilir
