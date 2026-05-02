import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, selectIsAuthenticated } from '@/store/auth';
import { isTauri, activityPing, listenInactivityLock } from '@/lib/tauri';

const INACTIVITY_MS = 10 * 60 * 1000; // 10 dakika (browser fallback)

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'] as const;

/**
 * İnaktiflik kilidi.
 *
 * Tauri ortamı: Rust arka plan thread'i timer'ı yönetir.
 *   - `inactivity_lock` eventi gelince session temizlenir.
 *   - Kullanıcı aktivitesinde `activity_ping` komutu ile Rust timer sıfırlanır.
 *
 * Browser ortamı (Vite dev / test): eski setTimeout tabanlı fallback çalışır.
 */
export function useInactivityLock() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const isAuthed = useAuthStore(selectIsAuthenticated);

  const lock = React.useCallback(() => {
    clear();
    navigate('/login', { replace: true });
  }, [clear, navigate]);

  // --- Tauri: inactivity_lock event dinleyici ---
  React.useEffect(() => {
    if (!isAuthed || !isTauri()) return;

    let unlisten: (() => void) | undefined;
    listenInactivityLock(lock).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [isAuthed, lock]);

  // --- Tauri: aktivite ping'leri ---
  React.useEffect(() => {
    if (!isAuthed || !isTauri()) return;

    const ping = () => {
      activityPing();
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, ping, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, ping);
      }
    };
  }, [isAuthed]);

  // --- Browser fallback: setTimeout tabanlı ---
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = React.useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(lock, INACTIVITY_MS);
  }, [lock]);

  React.useEffect(() => {
    if (isTauri()) return; // Tauri ortamında Rust halleder

    if (!isAuthed) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    reset();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset);
      }
    };
  }, [isAuthed, reset]);
}
