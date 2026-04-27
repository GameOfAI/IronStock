import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, setBaseUrl, getBaseUrl } from './client';
import { ApiError } from './errors';

beforeEach(() => {
  setBaseUrl('');
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('throws network_error when baseUrl not set', async () => {
    await expect(apiFetch('/api/v1/test')).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('setBaseUrl trims trailing slash', () => {
    setBaseUrl('https://test.local/');
    expect(getBaseUrl()).toBe('https://test.local');
    setBaseUrl('https://test.local');
    expect(getBaseUrl()).toBe('https://test.local');
  });

  it('throws ApiError on non-2xx', async () => {
    setBaseUrl('https://test.local');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 'not_found', message: 'Bulunamadı' }),
    });

    await expect(apiFetch('/api/v1/items')).rejects.toBeInstanceOf(ApiError);
  });

  it('returns undefined on 204', async () => {
    setBaseUrl('https://test.local');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const result = await apiFetch('/api/v1/logout', { method: 'POST' });
    expect(result).toBeUndefined();
  });
});
