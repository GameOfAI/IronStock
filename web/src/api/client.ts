/**
 * Typed fetch wrapper for the Envanter API.
 *
 * Responsibilities:
 *  - Attach Bearer access token from token-storage
 *  - On 401 invalid_token: try a single /auth/refresh, retry the request
 *  - On refresh failure (or refresh-token reuse): clear tokens, dispatch
 *    a custom 'auth:logout' event so the UI can navigate to /login
 *  - Map non-2xx responses to ApiError with the server's stable `code`
 *  - JSON in / JSON out — body objects are serialized, response parsed
 *
 * NOT a full SDK. Higher-level hooks (useFolders etc.) wrap this with
 * TanStack Query.
 *
 * ADR-0009 §1 wire format kararı: refresh rotation interceptor burada
 * toplanır, hook'lar yalnızca `apiFetch` çağrısı yapar.
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
  /**
   * Raw body for non-JSON requests (e.g. FormData for multipart uploads).
   * When set, Content-Type is NOT added — let the browser set it with the boundary.
   */
  rawBody?: BodyInit;
  /** When true, send WITHOUT Authorization (for /auth/login, /register). */
  unauthenticated?: boolean;
  /** Extra query params (string-stringified, undefined values dropped). */
  query?: Record<string, string | number | boolean | undefined>;
  /** Skip the refresh-on-401 retry loop (used internally to avoid loops). */
  noRetry?: boolean;
  signal?: AbortSignal;
}

/** The single in-flight refresh promise — collapses concurrent retries. */
let inflightRefresh: Promise<string> | null = null;

/**
 * Fire 'auth:logout' so the auth store + router can react. Centralized
 * here so the interceptor doesn't import store code (avoids cycles).
 */
function emitLogout(reason: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason } }));
}

function buildURL(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs.length === 0 ? path : `${path}?${qs}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorResponse = {
    code: 'unknown_error',
    message: `HTTP ${res.status}`,
  };
  try {
    const parsed = (await res.json()) as ApiErrorResponse;
    if (parsed && typeof parsed === 'object' && parsed.code && parsed.message) {
      body = parsed;
    }
  } catch {
    // Response wasn't JSON — keep the synthetic body.
  }
  return new ApiError(res.status, body);
}

/**
 * Run a single /auth/refresh round-trip. Resolves with the new access
 * token (also updates token-storage). Rejects when refresh fails for
 * any reason — caller treats as full logout.
 */
async function refreshOnce(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) {
    throw new ApiError(401, { code: ErrCode.Unauthorized, message: 'Oturum sona erdi.' });
  }
  const res = await fetch('/api/v1/auth/refresh', {
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

/**
 * Generic typed request. Returns the parsed JSON body (or undefined for
 * 204 No Content). Throws ApiError for non-2xx.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, rawBody, unauthenticated, query, noRetry, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // rawBody (FormData etc.) — NO Content-Type header, browser sets it with boundary.

  if (!unauthenticated) {
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const init: RequestInit = {
    method,
    headers,
    signal,
  };
  if (rawBody !== undefined) {
    init.body = rawBody;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const url = buildURL(path, query);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Network-layer failures (offline, DNS, connection refused).
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

  // 401 + invalid_token: try a single refresh + retry.
  if (!noRetry && !unauthenticated && isAccessTokenExpired(apiErr)) {
    try {
      await ensureRefresh();
    } catch {
      throw apiErr; // surface the original 401 (refresh already cleared state)
    }
    return apiFetch<T>(path, { ...options, noRetry: true });
  }

  throw apiErr;
}
