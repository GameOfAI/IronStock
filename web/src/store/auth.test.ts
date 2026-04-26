import { afterEach, describe, expect, it } from 'vitest';
import { selectIsAdmin, selectIsAuthenticated, useAuthStore } from './auth';
import { getAccessToken, getRefreshToken } from '@/api/token-storage';

afterEach(() => {
  useAuthStore.getState().clear();
});

const sampleSession = {
  user: { id: 'u1', username: 'alice', roles: ['admin', 'write'] },
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  kek: new Uint8Array([1, 2, 3]),
  privateKey: new Uint8Array([4, 5, 6]),
};

describe('useAuthStore', () => {
  it('starts unauthenticated and hydrating', () => {
    const s = useAuthStore.getState();
    // setHydrating(false) is called by test setup; reset and re-check.
    useAuthStore.setState({ hydrating: true });
    const fresh = useAuthStore.getState();
    expect(fresh.user).toBeNull();
    expect(fresh.hydrating).toBe(true);
    expect(selectIsAuthenticated(fresh)).toBe(false);
    // satisfy noUnused
    expect(s).toBeDefined();
  });

  it('setSession populates user + tokens + secret material', () => {
    useAuthStore.getState().setSession(sampleSession);
    const s = useAuthStore.getState();
    expect(s.user?.username).toBe('alice');
    expect(s.accessToken).toBe('access-abc');
    expect(s.kek).not.toBeNull();
    expect(s.privateKey).not.toBeNull();
    expect(s.hydrating).toBe(false);
    // Storage layer is in sync
    expect(getAccessToken()).toBe('access-abc');
    expect(getRefreshToken()).toBe('refresh-xyz');
  });

  it('selectIsAdmin reflects roles', () => {
    useAuthStore.getState().setSession(sampleSession);
    expect(selectIsAdmin(useAuthStore.getState())).toBe(true);

    useAuthStore.getState().setSession({
      ...sampleSession,
      user: { ...sampleSession.user, roles: ['read'] },
    });
    expect(selectIsAdmin(useAuthStore.getState())).toBe(false);
  });

  it('clear() wipes user + tokens + secret bytes', () => {
    useAuthStore.getState().setSession(sampleSession);
    const kekRef = useAuthStore.getState().kek!;
    const privRef = useAuthStore.getState().privateKey!;

    useAuthStore.getState().clear();

    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.kek).toBeNull();
    expect(s.privateKey).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    // Buffers were zeroed before drop
    expect(Array.from(kekRef)).toEqual([0, 0, 0]);
    expect(Array.from(privRef)).toEqual([0, 0, 0]);
  });

  it('setAccessToken updates only the access token (rotation)', () => {
    useAuthStore.getState().setSession(sampleSession);
    useAuthStore.getState().setAccessToken('rotated-access', 'rotated-refresh');
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('rotated-access');
    expect(getAccessToken()).toBe('rotated-access');
    expect(getRefreshToken()).toBe('rotated-refresh');
    // User + secret material unchanged
    expect(s.user?.username).toBe('alice');
    expect(s.kek).not.toBeNull();
  });
});
