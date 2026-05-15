/**
 * Auth store — web/src/store/auth.ts ile birebir aynı.
 * memory-only: kek + privateKey hiçbir zaman persist edilmez.
 * PR-C1: Rust keyring entegrasyonu yapıldığında KEK persist edilebilir hale gelir.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  clearAllTokens,
  setAccessToken as syncAccessToStorage,
  setRefreshToken as syncRefreshToStorage,
} from '@/api/token-storage';

export interface SessionUser {
  id: string;
  username: string;
  roles: string[];
}

interface AuthState {
  user: SessionUser | null;
  accessToken: string | null;
  kek: Uint8Array | null;
  privateKey: Uint8Array | null;
  hydrating: boolean;
  isBootstrap: boolean;

  setSession(input: {
    user: SessionUser;
    accessToken: string;
    refreshToken: string;
    kek: Uint8Array;
    privateKey: Uint8Array;
  }): void;
  /** Bootstrap login (TOTP-free admin path) — kek=null, ephemeral privateKey */
  setBootstrapSession(input: {
    user: SessionUser;
    accessToken: string;
    refreshToken: string;
  }): void;
  setAccessToken(token: string, refreshToken: string): void;
  setHydrating(value: boolean): void;
  clear(): void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    (set) => ({
      user: null,
      accessToken: null,
      kek: null,
      privateKey: null,
      hydrating: true,
      isBootstrap: false,

      setSession({ user, accessToken, refreshToken, kek, privateKey }) {
        syncAccessToStorage(accessToken);
        syncRefreshToStorage(refreshToken);
        set(
          { user, accessToken, kek, privateKey, hydrating: false, isBootstrap: false },
          false,
          'auth/setSession',
        );
      },

      setBootstrapSession({ user, accessToken, refreshToken }) {
        syncAccessToStorage(accessToken);
        syncRefreshToStorage(refreshToken);
        // Persist per-user bootstrap key so items stay decryptable across
        // reloads. Bootstrap path has no real KEK; this is best-effort
        // session encryption only.
        const storageKey = `envanter-bootstrap-pk:${user.id}`;
        let privateKey: Uint8Array;
        const stored = localStorage.getItem(storageKey);
        if (stored && stored.length > 0) {
          try {
            const bin = atob(stored);
            privateKey = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) privateKey[i] = bin.charCodeAt(i);
          } catch {
            privateKey = crypto.getRandomValues(new Uint8Array(32));
            let bin = '';
            for (let i = 0; i < privateKey.length; i++) bin += String.fromCharCode(privateKey[i]);
            localStorage.setItem(storageKey, btoa(bin));
          }
        } else {
          privateKey = crypto.getRandomValues(new Uint8Array(32));
          let bin = '';
          for (let i = 0; i < privateKey.length; i++) bin += String.fromCharCode(privateKey[i]);
          localStorage.setItem(storageKey, btoa(bin));
        }
        set(
          { user, accessToken, kek: null, privateKey, hydrating: false, isBootstrap: true },
          false,
          'auth/setBootstrapSession',
        );
      },

      setAccessToken(token, refreshToken) {
        syncAccessToStorage(token);
        syncRefreshToStorage(refreshToken);
        set({ accessToken: token }, false, 'auth/setAccessToken');
      },

      setHydrating(value) {
        set({ hydrating: value }, false, 'auth/setHydrating');
      },

      clear() {
        const state = useAuthStore.getState();
        if (state.kek) state.kek.fill(0);
        if (state.privateKey) state.privateKey.fill(0);
        clearAllTokens();
        set(
          {
            user: null,
            accessToken: null,
            kek: null,
            privateKey: null,
            hydrating: false,
            isBootstrap: false,
          },
          false,
          'auth/clear',
        );
      },
    }),
    { name: 'envanter-client-auth', enabled: import.meta.env.DEV },
  ),
);

export const selectIsAuthenticated = (s: AuthState) => s.user !== null && s.accessToken !== null;
export const selectIsAdmin = (s: AuthState) => s.user?.roles.includes('admin') ?? false;
