import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { selectIsAuthenticated } from '@/store/auth';

const INACTIVITY_MS = 10 * 60 * 1000; // 10 dakika

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'] as const;

/**
 * Kullanıcı 10 dakika hareketsiz kalırsa session'ı temizler ve /login'e yönlendirir.
 * Sadece authenticated state'de aktif; logout/clear sonrası otomatik devre dışı.
 *
 * PR-C1'de Rust tarafına taşınacak (inactivity timer Tauri process'inde tutulur).
 */
export function useInactivityLock() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const isAuthed = useAuthStore(selectIsAuthenticated);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = React.useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      clear();
      navigate('/login', { replace: true });
    }, INACTIVITY_MS);
  }, [clear, navigate]);

  React.useEffect(() => {
    if (!isAuthed) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    reset();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reset);
      }
    };
  }, [isAuthed, reset]);
}
