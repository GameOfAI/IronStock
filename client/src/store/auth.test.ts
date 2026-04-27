import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, selectIsAuthenticated, selectIsAdmin } from './auth';
import { getAccessToken } from '@/api/token-storage';

beforeEach(() => {
  useAuthStore.getState().clear();
  localStorage.clear();
});

const mockSession = {
  user: { id: 'u1', username: 'test', roles: ['read'] },
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  kek: new Uint8Array(32).fill(1),
  privateKey: new Uint8Array(32).fill(2),
};

describe('auth store', () => {
  it('starts unauthenticated', () => {
    const s = useAuthStore.getState();
    expect(selectIsAuthenticated(s)).toBe(false);
    expect(s.hydrating).toBe(true);
  });

  it('setSession populates state and token-storage', () => {
    useAuthStore.getState().setSession(mockSession);
    const s = useAuthStore.getState();
    expect(s.user?.username).toBe('test');
    expect(s.accessToken).toBe('access-token');
    expect(s.hydrating).toBe(false);
    expect(getAccessToken()).toBe('access-token');
    expect(selectIsAuthenticated(s)).toBe(true);
  });

  it('selectIsAdmin returns false for non-admin', () => {
    useAuthStore.getState().setSession(mockSession);
    expect(selectIsAdmin(useAuthStore.getState())).toBe(false);
  });

  it('selectIsAdmin returns true for admin role', () => {
    useAuthStore.getState().setSession({
      ...mockSession,
      user: { id: 'u2', username: 'admin', roles: ['admin', 'write'] },
    });
    expect(selectIsAdmin(useAuthStore.getState())).toBe(true);
  });

  it('clear wipes kek + privateKey (zeroize)', () => {
    const kek = new Uint8Array(32).fill(5);
    const priv = new Uint8Array(32).fill(6);
    useAuthStore.getState().setSession({ ...mockSession, kek, privateKey: priv });
    useAuthStore.getState().clear();

    expect(kek.every((b) => b === 0)).toBe(true);
    expect(priv.every((b) => b === 0)).toBe(true);
    expect(selectIsAuthenticated(useAuthStore.getState())).toBe(false);
    expect(getAccessToken()).toBeNull();
  });
});
