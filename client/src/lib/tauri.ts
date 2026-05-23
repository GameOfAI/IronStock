/**
 * Tauri runtime guard ve typed invoke wrappers.
 *
 * Tüm Tauri API çağrıları bu modül üzerinden yapılır.
 * Browser (Vite dev, test) ortamında `isTauri()` false döner
 * ve tüm wrapper'lar sessizce no-op/null döner.
 */

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI__' in window;

// --- Keyring ---

export async function kekStore(username: string, kekBase64: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('kek_store', { username, kekBase64 });
}

export async function kekLoad(username: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('kek_load', { username });
}

export async function kekDelete(username: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('kek_delete', { username });
}

// --- Inactivity ---

/** Rust inaktiflik timer'ını sıfırlar. Her kullanıcı aktivitesinde çağrılır. */
export async function activityPing(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  // fire-and-forget; hata kritik değil
  invoke('activity_ping').catch(() => {});
}

/** İnaktiflik timeout'unu saniye cinsinden günceller. */
export async function setInactivityTimeout(secs: number): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_inactivity_timeout', { secs });
}

// --- Screen capture protection ---

/**
 * Pencereyi ekran yakalama uygulamalarından gizler / gösterir.
 *
 * `enabled = true`  → ekrandan gizle (güvenli mod, varsayılan)
 * `enabled = false` → normal görünüm (kullanıcı devre dışı bıraktı)
 *
 * Tauri dışında (browser/test) no-op.
 */
export async function setContentProtection(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_content_protection', { enabled });
}

// --- Events ---

/** `inactivity_lock` Tauri eventini dinler. Tauri dışında no-op. */
export async function listenInactivityLock(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen('inactivity_lock', cb);
  return unlisten;
}
