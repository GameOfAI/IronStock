import { useMutation } from '@tanstack/react-query';
import { apiFetch, getBaseUrl } from './client';
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
 * TOTP init — tmp_token Authorization header gerektirir; token-storage dışı
 * tutulur. Client versiyonu: getBaseUrl() ile tam URL oluşturur.
 */
export function useTOTPInitMutation() {
  return useMutation({
    mutationFn: async (tmpToken: string) => {
      const res = await fetch(`${getBaseUrl()}/api/v1/auth/totp/init`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tmpToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'TOTP init hatası' }));
        throw new Error((body as { message?: string }).message ?? `TOTP init: ${res.status}`);
      }
      return (await res.json()) as TOTPInitResponse;
    },
  });
}

export function useTOTPVerifyMutation() {
  return useMutation({
    mutationFn: async (input: { tmpToken: string; code: string }) => {
      const res = await fetch(`${getBaseUrl()}/api/v1/auth/totp/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.tmpToken}`,
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
