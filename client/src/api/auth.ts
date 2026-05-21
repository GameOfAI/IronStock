import { useMutation } from '@tanstack/react-query';
import { apiFetch, getBaseUrl } from './client';
import { ApiError } from './errors';
import type {
  LoginRequest,
  LoginResponse,
  TOTPInitResponse,
  TOTPVerifyRequest,
  TOTPVerifyResponse,
} from './types';

export function useLoginMutation() {
  return useMutation({
    mutationFn: (input: LoginRequest) =>
      apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: input,
        unauthenticated: true,
      }),
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/v1/auth/logout', { method: 'POST' }),
  });
}

/**
 * TOTP init — bearer token Authorization header gerektirir; token-storage dışı
 * tutulur. PR-SEC2: tmp_token (eski flow) veya access_token (gate flow) kabul eder.
 * Client versiyonu: getBaseUrl() ile tam URL oluşturur.
 */
export function useTOTPInitMutation() {
  return useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch(`${getBaseUrl()}/api/v1/auth/totp/init`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'TOTP init hatası' }));
        throw new Error((body as { message?: string }).message ?? `TOTP init: ${res.status}`);
      }
      return (await res.json()) as TOTPInitResponse;
    },
  });
}

/**
 * keypair-init — placeholder keypair'i proper one ile değiştirir.
 * Şifre değişmez, session revoke edilmez. Sadece kek_params.alg=="none" iken çalışır.
 */
/**
 * keypair-init — placeholder keypair'i proper one ile değiştirir.
 * Şifre değişmez, session revoke edilmez. Sadece kek_params.alg=="none" iken çalışır.
 */
export async function initKeypair(
  accessToken: string,
  payload: {
    current_master_password: string;
    new_public_key: string;       // base64
    new_private_key_enc: string;  // base64
    new_kek_salt: string;         // base64
    new_kek_params: Record<string, unknown>;
  },
): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/api/v1/auth/keypair-init`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, {
      code: (body as { code?: string }).code ?? 'internal',
      message: (body as { message?: string }).message ?? `keypair-init: ${res.status}`,
    });
  }
}

export function useTOTPVerifyMutation() {
  return useMutation({
    mutationFn: async (input: { token: string; code: string }) => {
      const res = await fetch(`${getBaseUrl()}/api/v1/auth/totp/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: input.code } satisfies TOTPVerifyRequest),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'TOTP doğrulama hatası' }));
        throw new Error((body as { message?: string }).message ?? `TOTP verify: ${res.status}`);
      }
      return (await res.json()) as TOTPVerifyResponse;
    },
  });
}
