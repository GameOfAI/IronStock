import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAllTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './token-storage';

afterEach(() => {
  clearAllTokens();
});

describe('token-storage', () => {
  it('access token is memory-only (round-trips via setter)', () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken('access-abc');
    expect(getAccessToken()).toBe('access-abc');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });

  it('refresh token persists to localStorage', () => {
    expect(getRefreshToken()).toBeNull();
    setRefreshToken('refresh-xyz');
    expect(localStorage.getItem('envanter.refresh_token')).toBe('refresh-xyz');
    expect(getRefreshToken()).toBe('refresh-xyz');
  });

  it('clearAllTokens wipes both', () => {
    setAccessToken('a');
    setRefreshToken('r');
    clearAllTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('setRefreshToken(null) removes the key entirely', () => {
    setRefreshToken('r');
    setRefreshToken(null);
    expect(localStorage.getItem('envanter.refresh_token')).toBeNull();
  });
});
