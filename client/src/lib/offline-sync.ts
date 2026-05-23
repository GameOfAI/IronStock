/**
 * Offline Sync Engine — çevrimdışı kuyruktaki op'ları tekrar dener.
 *
 * Tetiklenme koşulları:
 *   - `window` online event'i (tarayıcı ağ algılaması)
 *   - App açılışında (use-offline-sync.ts hook'u)
 *   - Manuel çağrı (useOfflineSync.syncNow())
 *
 * Retry politikası:
 *   - Her başarılı op kuyruğtan çıkarılır.
 *   - Network hatası (status 0) → dur (hâlâ offline), diğer op'lar beklemeye alınır.
 *   - API hatası (4xx/5xx) → retryCount artar; retryCount >= MAX_RETRIES → kalıcı hata,
 *     op kuyruğtan çıkarılır (veri kaybı riski var — kullanıcıya toast ile bildirilir).
 *
 * Concurrency:
 *   - Op'lar sırayla tekrar denenir (paralel değil) — sıra önemli olabilir (POST → PATCH).
 *   - Eş zamanlı syncPendingOps çağrısı korunur: çalışıyorsa ikincisi atlanır.
 */

import { ApiError } from '@/api/errors';
import { apiFetch } from '@/api/client';
import {
  loadPendingOps,
  removePendingOp,
  incrementRetryCount,
  type PendingOp,
} from '@/lib/pending-ops';
import { usePendingOpsStore } from '@/store/pending-ops';

const MAX_RETRIES = 3;

/** Sync motoru şu anda çalışıyor mu? (concurrency guard) */
let _isSyncing = false;

export interface SyncResult {
  /** Başarıyla tekrar gönderilen op sayısı. */
  replayed: number;
  /** Kalıcı hata nedeniyle çıkarılan op sayısı (max retry aşıldı). */
  discarded: number;
  /** Network hatası — hâlâ offline, op'lar kuyruğta beklemeye devam ediyor. */
  stillOffline: boolean;
}

/**
 * Kuyruktaki tüm pending op'ları sırayla tekrar dener.
 * Dönüş değeri: kaç tane başarılı, kaç tane çıkarıldı.
 */
export async function syncPendingOps(): Promise<SyncResult> {
  if (_isSyncing) return { replayed: 0, discarded: 0, stillOffline: false };

  _isSyncing = true;

  const result: SyncResult = { replayed: 0, discarded: 0, stillOffline: false };

  try {
    // Store'u disk'teki gerçek durum ile senkronize et.
    const ops = await loadPendingOps();
    usePendingOpsStore.getState().setOps(ops);

    for (const op of ops) {
      try {
        await apiFetch(op.path, {
          method: op.method,
          body: op.body,
          noRetry: false, // token yenileme izni var
        });

        // Başarılı — kuyruğtan çıkar, store'dan sil.
        await removePendingOp(op.id);
        usePendingOpsStore.getState().removeOp(op.id);
        result.replayed++;

      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          // Network hatası — hâlâ offline, döngüden çık.
          result.stillOffline = true;
          break;
        }

        // API hatası (4xx/5xx) — retry sayısını artır.
        const updated = await incrementRetryCount(op.id);
        if (updated) {
          usePendingOpsStore.getState().updateOp(updated);

          if (updated.retryCount >= MAX_RETRIES) {
            // Kalıcı hata — kuyruğtan çıkar.
            await removePendingOp(op.id);
            usePendingOpsStore.getState().removeOp(op.id);
            result.discarded++;

            // Kullanıcıya bildir (toast event).
            dispatchDiscardedEvent(op);
          }
        }
      }
    }
  } finally {
    _isSyncing = false;
  }

  return result;
}

/** Kalıcı hata event'i — App.tsx veya hook'ta toast için dinlenir. */
function dispatchDiscardedEvent(op: PendingOp) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('offline-sync:discarded', {
      detail: { op },
    }),
  );
}
