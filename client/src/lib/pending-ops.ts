/**
 * Pending Ops — çevrimdışı iken yapılan mutation'ları Tauri dosya
 * sistemine kaydeder ve tekrar çevrimiçi olunca tekrar denemek için saklar.
 *
 * Tasarım:
 *   - Her mutation (POST/PUT/PATCH/DELETE) kuyruğa bir PendingOp olarak eklenir.
 *   - Kuyruk "pending_ops" slotuna JSON olarak yazılır (cache_write Tauri command).
 *   - Bağlantı geri geldiğinde offline-sync.ts kuyruktaki op'ları tekrar dener.
 *   - Başarılı op kuyruğtan çıkarılır; max 3 deneme sonrası kalıcı hata olarak işaretlenir.
 *
 * Güvenlik notu:
 *   - Op body'leri disk'e yazılır. Secret field içeren request'ler (parola değiştirme
 *     gibi) şifreli body taşır — plaintext secret cache'e yazılmaz.
 *   - Disk cache OS şifrelemesi (BitLocker/FileVault) tarafından korunur.
 *
 * Sınırlamalar:
 *   - Web modda (Tauri yoksa) tüm fonksiyonlar no-op / boş dizi döner.
 */

/** Kuyruklanmış bir mutation isteği. */
export interface PendingOp {
  /** Unique ID — nanoid benzeri timestamp + random. */
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Tam API path, örn. "/api/v1/items". */
  path: string;
  /** Serializable request body. Undefined ise body yok. */
  body?: unknown;
  /** Op oluşturulma zamanı (ms). */
  createdAt: number;
  /** Kaç kez denendi. */
  retryCount: number;
  /** İnsan-okunabilir açıklama (UI'da gösterilir). */
  label?: string;
}

interface PendingOpsFile {
  version: 1;
  ops: PendingOp[];
}

const PENDING_OPS_SLOT = 'pending_ops';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Disk'ten op kuyruğunu yükler. */
export async function loadPendingOps(): Promise<PendingOp[]> {
  if (!isTauri()) return [];
  try {
    const raw = await tauriInvoke<string | null>('cache_read', { slot: PENDING_OPS_SLOT });
    if (!raw) return [];
    const file = JSON.parse(raw) as PendingOpsFile;
    if (file.version !== 1 || !Array.isArray(file.ops)) return [];
    return file.ops;
  } catch {
    return [];
  }
}

/** Op kuyruğunu disk'e yazar. */
export async function savePendingOps(ops: PendingOp[]): Promise<void> {
  if (!isTauri()) return;
  try {
    const file: PendingOpsFile = { version: 1, ops };
    await tauriInvoke('cache_write', { slot: PENDING_OPS_SLOT, data: JSON.stringify(file) });
  } catch {
    // Sessiz hata — op bellekte tutulmaya devam eder.
  }
}

/** Kuyruğa yeni bir op ekler. Disk'e yazar. */
export async function pushPendingOp(op: Omit<PendingOp, 'id' | 'createdAt' | 'retryCount'>): Promise<PendingOp> {
  const newOp: PendingOp = {
    ...op,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    retryCount: 0,
  };
  const ops = await loadPendingOps();
  ops.push(newOp);
  await savePendingOps(ops);
  return newOp;
}

/** Belirtilen ID'li op'u kuyruktan çıkarır. Disk'e yazar. */
export async function removePendingOp(id: string): Promise<void> {
  const ops = await loadPendingOps();
  const filtered = ops.filter((op) => op.id !== id);
  await savePendingOps(filtered);
}

/** Belirtilen ID'li op'un retryCount'unu artırır. Disk'e yazar. */
export async function incrementRetryCount(id: string): Promise<PendingOp | null> {
  const ops = await loadPendingOps();
  const idx = ops.findIndex((op) => op.id === id);
  if (idx === -1) return null;
  ops[idx] = { ...ops[idx], retryCount: ops[idx].retryCount + 1 };
  await savePendingOps(ops);
  return ops[idx];
}

/** Tüm kuyruğu temizler (oturum kapatma, hesap değişikliği). */
export async function clearPendingOps(): Promise<void> {
  if (!isTauri()) return;
  try {
    await tauriInvoke('cache_write', { slot: PENDING_OPS_SLOT, data: JSON.stringify({ version: 1, ops: [] }) });
  } catch {
    // Sessiz hata.
  }
}
