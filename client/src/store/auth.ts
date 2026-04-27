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

  setSession(input: {
    user: SessionUser;
    accessToken: string;
    refreshToken: string;
    kek: Uint8Array;
    privateKey: Uint8Array;
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

      setSession({ user, accessToken, refreshToken, kek, privateKey }) {
        syncAccessToStorage(accessToken);
        syncRefreshToStorage(refreshToken);
        set({ user, accessToken, kek, privateKey, hydrating: false }, false, 'auth/setSession');
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
          { user: null, accessToken: null, kek: null, privateKey: null, hydrating: false },
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
