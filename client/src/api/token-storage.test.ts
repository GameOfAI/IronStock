import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  clearAllTokens,
} from './token-storage';

beforeEach(() => {
  clearAllTokens();
  localStorage.clear();
});

describe('token-storage', () => {
  it('access token is memory-only', () => {
    setAccessToken('acc123');
    expect(getAccessToken()).toBe('acc123');
    expect(localStorage.getItem('envanter.refresh_token')).toBeNull();
  });

  it('refresh token persists to localStorage', () => {
    setRefreshToken('ref456');
    expect(getRefreshToken()).toBe('ref456');
    expect(localStorage.getItem('envanter.refresh_token')).toBe('ref456');
  });

  it('clearAllTokens wipes both', () => {
    setAccessToken('a');
    setRefreshToken('r');
    clearAllTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('setRefreshToken(null) removes key', () => {
    setRefreshToken('r');
    setRefreshToken(null);
    expect(getRefreshToken()).toBeNull();
  });
});
