/**
 * Token storage — web paketiyle aynı strateji:
 *   accessToken  : memory-only
 *   refreshToken : localStorage (Tauri'de güvenli; PR-C1'de Rust keyring'e taşınacak)
 *
 * KEK + privateKey auth Zustand store'unda, memory-only.
 */

const REFRESH_KEY = 'envanter.refresh_token';

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
    // Storage kota / private mod — sessizce geç.
  }
}

export function clearAllTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}
