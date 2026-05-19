/**
 * Typed fetch wrapper — web/src/api/client.ts ile aynı mantık.
 * Tek fark: base URL sabit değil, connection store'dan okunur.
 *
 * Tauri app farklı sunuculara bağlanabilir (ConnectionGate ile ayarlanır).
 * Tüm istek path'leri `${baseUrl}/api/v1/...` formatında oluşturulur.
 *
 * baseUrl boşsa ConnectionGate /config'e yönlendirmiş olur;
 * bu fonksiyon hiç çağrılmamalı. Yine de boş gelirse NetworkError fırlatır.
 */

import {
  clearAllTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './token-storage';
import { ApiError, ErrCode, isAccessTokenExpired } from './errors';
import type { ApiErrorResponse, RefreshResponse } from './types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  unauthenticated?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
  noRetry?: boolean;
  signal?: AbortSignal;
}

/** Tek in-flight refresh promise — eş zamanlı retry'ları birleştirir. */
let inflightRefresh: Promise<string> | null = null;

/** Kaydedilmiş base URL — setBaseUrl() ile AppShell/ConnectionGate tarafından set edilir. */
let _baseUrl = '';
/** TLS skip-verify flag — geliştirme ortamında self-signed sertifikalar için. */
let _tlsSkipVerify = false;

export function setBaseUrl(url: string): void {
  _baseUrl = url.replace(/\/$/, '');
}

export function getBaseUrl(): string {
  return _baseUrl;
}

export function setTlsSkipVerify(value: boolean): void {
  _tlsSkipVerify = value;
}

/**
 * TLS bypass desteği olan fetch wrapper.
 *
 * Tauri ortamında `_tlsSkipVerify` aktifse self-signed sertifikalı sunuculara
 * Rust reqwest üzerinden bağlanır. Aksi hâlde standart browser `fetch()` kullanılır.
 */
export async function rawFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (_tlsSkipVerify && typeof window !== 'undefined' && '__TAURI__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    const headers: Record<string, string> = {};
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await invoke('tls_fetch', {
      url,
      method: init.method ?? 'GET',
      headers,
      body: (init.body as string | null | undefined) ?? null,
      tlsSkipVerify: true,
    })) as { status: number; body: string };
    return new Response(result.body || null, { status: result.status });
  }
  return fetch(url, init);
}

function emitLogout(reason: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason } }));
}

function buildURL(path: string, query?: RequestOptions['query']): string {
  const full = `${_baseUrl}${path}`;
  if (!query) return full;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs.length === 0 ? full : `${full}?${qs}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorResponse = { code: 'unknown_error', message: `HTTP ${res.status}` };
  try {
    const parsed = (await res.json()) as ApiErrorResponse;
    if (parsed && typeof parsed === 'object' && parsed.code && parsed.message) {
      body = parsed;
    }
  } catch {
    // JSON değilse synthetic body kalsın.
  }
  return new ApiError(res.status, body);
}

async function refreshOnce(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) {
    throw new ApiError(401, { code: ErrCode.Unauthorized, message: 'Oturum sona erdi.' });
  }
  const res = await rawFetch(`${_baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as RefreshResponse;
  setAccessToken(body.access_token);
  setRefreshToken(body.refresh_token);
  return body.access_token;
}

async function ensureRefresh(): Promise<string> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = refreshOnce()
    .catch((err) => {
      clearAllTokens();
      emitLogout(err instanceof ApiError ? err.code : 'refresh_failed');
      throw err;
    })
    .finally(() => {
      inflightRefresh = null;
    });
  return inflightRefresh;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (!_baseUrl) {
    throw new ApiError(0, { code: 'network_error', message: 'Sunucu adresi ayarlanmamış.' });
  }

  const { method = 'GET', body, unauthenticated, query, noRetry, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!unauthenticated) {
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const init: RequestInit = { method, headers, signal };
  if (body !== undefined) init.body = JSON.stringify(body);

  const url = buildURL(path, query);
  let res: Response;
  try {
    res = await rawFetch(url, init);
  } catch (err) {
    throw new ApiError(0, {
      code: 'network_error',
      message: 'Sunucuya ulaşılamadı.',
      details: { reason: (err as Error).message },
    });
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const apiErr = await parseError(res);

  if (!noRetry && !unauthenticated && isAccessTokenExpired(apiErr)) {
    try {
      await ensureRefresh();
    } catch {
      throw apiErr;
    }
    return apiFetch<T>(path, { ...options, noRetry: true });
  }

  throw apiErr;
}
