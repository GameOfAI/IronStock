/**
 * Offline cache — TanStack Query cache'ini Tauri dosya sistemine persist eder.
 *
 * Tasarım:
 *   - TanStack Query, query'leri in-memory tutar (gcTime süresince).
 *     Uygulama kapanınca bu cache silinir; yeniden açılınca network gerekir.
 *   - Bu modül, query cache snapshot'ını "queries.json" slotuna yazar.
 *   - Uygulama açılışında bu dosyayı okur ve queryClient'a inject eder.
 *   - Network hatası durumunda kullanıcı son bilinen veriyi görür.
 *
 * Güvenlik notu:
 *   - Cache yalnızca metadata içerir (item isimleri, IP'ler, vs.).
 *   - Secret field'lar (parola, private key) cache'e yazılmaz — bu veriler
 *     apiFetch'ten plaintext dönmez; şifreli blob olarak döner ve client
 *     tarafında çözülür. Çözülmüş hâl hiçbir zaman queryClient'a yazılmaz.
 *   - Cache auth token içermez.
 *
 * Sınırlamalar:
 *   - Web modda (Tauri yoksa) tüm fonksiyonlar no-op.
 *   - Tauri invoke hatası durumunda sessizce devam edilir (cache bozulmuşsa
 *     query normal network isteğiyle yenilenir).
 */

import type { QueryClient, Query } from '@tanstack/react-query';

const CACHE_SLOT = 'queries';
const SAVE_DEBOUNCE_MS = 2_000;   // 2 saniye debounce — her mutation'da yazma
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60_000;  // 7 gün

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ─── Serialization ───────────────────────────────────────────────────────────

interface CachedQuery {
  queryKey: unknown[];
  data: unknown;
  dataUpdatedAt: number;
}

interface CacheFile {
  version: 1;
  savedAt: number;
  queries: CachedQuery[];
}

/** Serialize query cache to a plain object for JSON storage. */
function serializeCache(queryClient: QueryClient): CacheFile {
  const queries: CachedQuery[] = [];

  for (const query of queryClient.getQueryCache().getAll()) {
    // Skip: no data, pending, error, or stale placeholder states.
    if (query.state.status !== 'success') continue;
    if (query.state.data === undefined) continue;

    queries.push({
      queryKey: query.queryKey as unknown[],
      data: query.state.data,
      dataUpdatedAt: query.state.dataUpdatedAt,
    });
  }

  return { version: 1, savedAt: Date.now(), queries };
}

/** Restore cached queries into queryClient WITHOUT triggering refetches. */
function hydrateCache(queryClient: QueryClient, file: CacheFile): number {
  const now = Date.now();
  let restored = 0;

  for (const entry of file.queries) {
    // Skip entries older than MAX_CACHE_AGE_MS.
    if (now - entry.dataUpdatedAt > MAX_CACHE_AGE_MS) continue;

    // Only set if no newer live data exists.
    const existing = queryClient.getQueryState(entry.queryKey);
    if (existing?.dataUpdatedAt && existing.dataUpdatedAt >= entry.dataUpdatedAt) continue;

    queryClient.setQueryData(entry.queryKey, entry.data, {
      updatedAt: entry.dataUpdatedAt,
    });
    restored++;
  }

  return restored;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Uygulama açılışında dosyadan cache'i yükle ve queryClient'a inject et. */
export async function loadCacheFromDisk(queryClient: QueryClient): Promise<void> {
  if (!isTauri()) return;
  try {
    const raw = await tauriInvoke<string | null>('cache_read', { slot: CACHE_SLOT });
    if (!raw) return;

    const file = JSON.parse(raw) as CacheFile;
    if (file.version !== 1) return;
    if (Date.now() - file.savedAt > MAX_CACHE_AGE_MS) return;

    const count = hydrateCache(queryClient, file);
    if (import.meta.env.DEV) {
      console.debug(`[offline-cache] ${count} query yüklendi (${file.queries.length} toplam, ${new Date(file.savedAt).toLocaleTimeString('tr-TR')} tarihli)`);
    }
  } catch (err) {
    // Cache bozuk veya eski format — sessizce atla.
    if (import.meta.env.DEV) console.warn('[offline-cache] yükleme başarısız:', err);
  }
}

/** Cache'i diske yazar. Debounced. */
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSaveCache(queryClient: QueryClient): void {
  if (!isTauri()) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveNow(queryClient);
  }, SAVE_DEBOUNCE_MS);
}

async function saveNow(queryClient: QueryClient): Promise<void> {
  try {
    const file = serializeCache(queryClient);
    await tauriInvoke('cache_write', { slot: CACHE_SLOT, data: JSON.stringify(file) });
    if (import.meta.env.DEV) {
      console.debug(`[offline-cache] ${file.queries.length} query kaydedildi`);
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[offline-cache] kayıt başarısız:', err);
  }
}

/** Oturum kapatma / hesap değişikliğinde cache'i temizle. */
export async function clearDiskCache(): Promise<void> {
  if (!isTauri()) return;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  try {
    await tauriInvoke('cache_clear');
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[offline-cache] temizleme başarısız:', err);
  }
}

/**
 * TanStack Query cache değişikliklerini dinleyerek otomatik kayıt tetikler.
 * App.tsx'te QueryClient oluşturulduktan sonra bir kez çağrılmalı.
 *
 * Dönüş değeri: unsubscribe fonksiyonu (cleanup için).
 */
export function subscribeQueryCacheForPersist(queryClient: QueryClient): () => void {
  if (!isTauri()) return () => {};

  const queryCache = queryClient.getQueryCache();

  const unsubscribe = queryCache.subscribe((event) => {
    // Sadece başarılı veri güncellemelerinde kaydet.
    if (
      event.type === 'updated' &&
      (event as { action?: { type?: string } }).action?.type === 'success'
    ) {
      scheduleSaveCache(queryClient);
    }
  });

  return unsubscribe;
}

// Expose Query type for the subscriber (avoids unused import warning)
export type { Query };
