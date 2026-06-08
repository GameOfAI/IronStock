/**
 * Token storage strategy:
 *
 *   accessToken  — memory only (never persisted; ~15min TTL anyway,
 *                  re-derived on page reload from refresh).
 *   refreshToken — localStorage (7d TTL, opaque 32B hex). XSS-vulnerable
 *                  by definition; mitigations:
 *                    - CSP (Faz 5)
 *                    - server-side reuse detection (PR-6)
 *                    - HttpOnly cookie alternative deferred to Faz 5
 *                      (browser/Tauri unification call).
 *
 * KEK and privateKey are NOT touched here — they live in the auth Zustand
 * store, memory-only, cleared on logout / refresh failure.
 */

const REFRESH_KEY = 'envanter.refresh_token';
const SESSION_KEY = 'envanter.session';

/** Persisted session metadata — enough to restore after page reload. */
export interface PersistedSession {
  user: { id: string; username: string; roles: string[] };
  mustChangePassword?: boolean;
  mustSetupTOTP?: boolean;
  isBootstrap?: boolean;
}

// In-memory access token. Re-fetched after page reload via /auth/refresh.
let accessTokenInMemory: string | null = null;

export function getAccessToken(): string | null {
  return accessTokenInMemory;
}

export function setAccessToken(token: string | null): void {
  accessTokenInMemory = token;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(REFRESH_KEY);
    } else {
      localStorage.setItem(REFRESH_KEY, token);
    }
  } catch {
    // Storage quota / private mode — silently ignore. Caller will see the
    // user fall through to the login screen on next reload.
  }
}

export function getPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export function setPersistedSession(session: PersistedSession | null): void {
  try {
    if (session === null) {
      localStorage.removeItem(SESSION_KEY);
    } else {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Storage quota / private mode — silently ignore.
  }
}

export function clearAllTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
  setPersistedSession(null);
}
