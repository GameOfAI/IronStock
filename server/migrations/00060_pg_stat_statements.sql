-- PR-PROD5: pg_stat_statements — sorgu performans izleme
-- Bu extension sorgu istatistiklerini toplar (çağrı sayısı, ortalama süre, vb.)
-- N+1 sorgu tespiti ve SLO ihlal analizi için kullanılır.
--
-- NOT: shared_preload_libraries = 'pg_stat_statements' postgresql.conf'ta
-- gereklidir. Extension zaten yüklüyse CREATE sessizce atlanır.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- pg_stat_statements.track = 'all' önerilir (nested sorgular dahil).
-- Bu ayar postgresql.conf / ALTER SYSTEM ile yapılmalıdır:
--   ALTER SYSTEM SET pg_stat_statements.track = 'all';
--   ALTER SYSTEM SET pg_stat_statements.max = 5000;
--   SELECT pg_reload_conf();
