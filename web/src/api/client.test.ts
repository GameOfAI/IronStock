import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';
import { ApiError, ErrCode } from './errors';
import { clearAllTokens, setAccessToken, setRefreshToken } from './token-storage';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  clearAllTokens();
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  clearAllTokens();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  it('attaches Bearer access token', async () => {
    setAccessToken('access-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await apiFetch('/api/v1/folders');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-abc');
  });

  it('omits Authorization when unauthenticated:true', async () => {
    setAccessToken('access-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiFetch('/api/v1/auth/login', {
      method: 'POST',
      body: { username: 'x' },
      unauthenticated: true,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('parses JSON body and returns it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { folders: [{ id: 'f1' }] }));
    const result = await apiFetch<{ folders: Array<{ id: string }> }>('/api/v1/folders');
    expect(result.folders[0].id).toBe('f1');
  });

  it('returns undefined on 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await apiFetch('/api/v1/folders/abc');
    expect(result).toBeUndefined();
  });

  it('throws ApiError with server code on 4xx', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { code: 'forbidden', message: 'Yetkiniz yok.' }),
    );
    const err = (await apiFetch('/api/v1/admin/users').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('forbidden');
  });

  it('refreshes once on 401 invalid_token, retries successfully', async () => {
    setAccessToken('expired');
    setRefreshToken('refresh-1');

    // 1st: 401 invalid_token; 2nd (refresh): 200; 3rd (retry): 200
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { code: ErrCode.InvalidToken, message: 'Token geçersiz.' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 900,
          token_type: 'Bearer',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));

    const out = await apiFetch<{ items: unknown[] }>('/api/v1/items', { query: { folder_id: 'f1' } });
    expect(out.items).toEqual([]);
    expect(fetchMock.mock.calls.length).toBe(3);
    // Retry must use the new access token
    const retryHeaders = fetchMock.mock.calls[2][1].headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer new-access');
  });

  it('emits auth:logout when refresh fails', async () => {
    setAccessToken('expired');
    setRefreshToken('refresh-1');

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { code: ErrCode.InvalidToken, message: 'Token geçersiz.' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, {
          code: ErrCode.InvalidCreds,
          message: 'Refresh reddedildi.',
        }),
      );

    const events: string[] = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent).detail.reason);
    };
    window.addEventListener('auth:logout', listener);

    await expect(apiFetch('/api/v1/items', { query: { folder_id: 'f1' } })).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(events).toEqual(['invalid_credentials']);
    window.removeEventListener('auth:logout', listener);
  });

  it('builds query string from query params, drops undefined', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiFetch('/api/v1/admin/users', {
      query: { limit: 50, offset: 0, action: undefined },
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=0');
    expect(url).not.toContain('action');
  });

  it('wraps network errors with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = (await apiFetch('/api/v1/folders').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('network_error');
  });
});
