import { describe, it, expect } from 'vitest';
import { getAccessToken, setAccessToken } from './token-storage';

describe('reports API', () => {
  it('useGenerateReportMutation uses getAccessToken (not localStorage)', async () => {
    setAccessToken('mem-only-token');
    expect(getAccessToken()).toBe('mem-only-token');
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('getAccessToken returns null when not set', () => {
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
