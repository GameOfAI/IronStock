/**
 * Auth store — single source of truth for the logged-in user's session.
 *
 * Memory-only fields (cleared on logout / refresh failure / page reload):
 *   - kek          : 32B Argon2id-derived (master_password + kek_salt)
 *   - privateKey   : 32B X25519, decrypted from private_key_enc with KEK
 *   - accessToken  : also held in api/token-storage; mirrored here for
 *                    React subscribers (the hook layer reads from store)
 *
 * Persisted (refresh-token survives reload):
 *   - refreshToken : actually held in api/token-storage (localStorage).
 *                    Store doesn't duplicate; pulls via getRefreshToken
 *                    when a hook needs it.
 *
 * On `clear()` we wipe both memory + storage AND emit an event the
 * router listens for ('auth:logout') to redirect to /login.
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
  /** Argon2id(master_password, kek_salt). 32B. NEVER persisted. */
  kek: Uint8Array | null;
  /** X25519 private, decrypted from server's private_key_enc. NEVER persisted. */
  privateKey: Uint8Array | null;
  /** True until we've checked refresh_token at app boot. UI shows splash. */
  hydrating: boolean;
  /** True when logged in via the TOTP-free bootstrap panel (ADR-0010). */
  isBootstrap: boolean;

  setSession(input: {
    user: SessionUser;
    accessToken: string;
    refreshToken: string;
    kek: Uint8Array;
    privateKey: Uint8Array;
  }): void;
  /** Bootstrap login — no kek/privateKey available (TOTP-free admin path). */
  setBootstrapSession(input: {
    user: SessionUser;
    accessToken: string;
    refreshToken: string;
  }): void;
  /** Update only the access token (after refresh rotation). */
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
          {
            user,
            accessToken,
            kek,
            privateKey,
            hydrating: false,
            isBootstrap: false,
          },
          false,
          'auth/setSession',
        );
      },

      setBootstrapSession({ user, accessToken, refreshToken }) {
        syncAccessToStorage(accessToken);
        syncRefreshToStorage(refreshToken);
        set(
          {
            user,
            accessToken,
            kek: null,
            privateKey: null,
            hydrating: false,
            isBootstrap: true,
          },
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
        // Best-effort wipe of secret material before drop. JS can't
        // truly zeroize, but overwriting the buffer at least removes
        // it from any subsequent inspection.
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
    { name: 'envanter-auth', enabled: import.meta.env.DEV },
  ),
);

/** Selectors — hooks should subscribe narrowly. */
export const selectIsAuthenticated = (s: AuthState) => s.user !== null && s.accessToken !== null;
export const selectIsAdmin = (s: AuthState) => s.user?.roles.includes('admin') ?? false;
export const selectHasRole = (role: string) => (s: AuthState) => s.user?.roles.includes(role) ?? false;
export const selectIsBootstrap = (s: AuthState) => s.isBootstrap;
