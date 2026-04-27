import { describe, it, expect, beforeEach } from 'vitest';
import { useConnectionStore } from './connection';
import { getBaseUrl } from '@/api/client';

beforeEach(() => {
  useConnectionStore.getState().clearConnection();
  localStorage.clear();
});

describe('connection store', () => {
  it('setConnection trims trailing slash and syncs api/client', () => {
    useConnectionStore.getState().setConnection('https://envanter.sirket.com/');
    expect(useConnectionStore.getState().serverUrl).toBe('https://envanter.sirket.com');
    expect(getBaseUrl()).toBe('https://envanter.sirket.com');
  });

  it('clearConnection resets serverUrl and api/client', () => {
    useConnectionStore.getState().setConnection('https://test.local');
    useConnectionStore.getState().clearConnection();
    expect(useConnectionStore.getState().serverUrl).toBe('');
    expect(getBaseUrl()).toBe('');
  });

  it('tlsSkipVerify defaults to false', () => {
    useConnectionStore.getState().setConnection('https://test.local');
    expect(useConnectionStore.getState().tlsSkipVerify).toBe(false);
  });

  it('tlsSkipVerify can be set to true', () => {
    useConnectionStore.getState().setConnection('https://test.local', true);
    expect(useConnectionStore.getState().tlsSkipVerify).toBe(true);
  });
});
