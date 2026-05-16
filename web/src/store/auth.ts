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
  /** True when the user must change their password before accessing the app.
   *  Set for admin-created accounts and the default seed admin on first run.
   *  Cleared after successful POST /auth/change-password. */
  mustChangePassword: boolean;

  setSession(input: {
    user: SessionUser;
    accessToken: string;
    refreshToken: string;
    kek: Uint8Array;
    privateKey: Uint8Array;
    mustChangePassword?: boolean;
  }): void;
  /** Bootstrap login — no kek/privateKey available (TOTP-free admin path). */
  setBootstrapSession(input: {
    user: SessionUser;
    accessToken: string;
    refreshToken: string;
    mustChangePassword?: boolean;
  }): void;
  /** Clear the must_change_password flag after a successful password change. */
  clearMustChangePassword(): void;
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
      mustChangePassword: false,

      setSession({ user, accessToken, refreshToken, kek, privateKey, mustChangePassword }) {
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
            mustChangePassword: mustChangePassword ?? false,
          },
          false,
          'auth/setSession',
        );
      },

      setBootstrapSession({ user, accessToken, refreshToken, mustChangePassword }) {
        syncAccessToStorage(accessToken);
        syncRefreshToStorage(refreshToken);
        // Persist a per-user bootstrap key in localStorage so items created in
        // one session remain decryptable across reloads / re-logins. Without
        // this, every bootstrap login mints a fresh random key and previously
        // created items become un-decryptable.
        //
        // Trade-off: any code with localStorage access can read this key.
        // Bootstrap is explicitly for early/IAM use — full E2E security is
        // only available via the normal (TOTP) login path with KEK-derived
        // private keys.
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
          {
            user,
            accessToken,
            kek: null,
            privateKey,
            hydrating: false,
            isBootstrap: true,
            mustChangePassword: mustChangePassword ?? false,
          },
          false,
          'auth/setBootstrapSession',
        );
      },

      clearMustChangePassword() {
        set({ mustChangePassword: false }, false, 'auth/clearMustChangePassword');
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
            mustChangePassword: false,
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
