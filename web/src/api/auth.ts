import { apiFetch } from './client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RecoverCompleteRequest,
  RecoverCompleteResponse,
  RecoverInitRequest,
  RecoverInitResponse,
  TOTPDisableRequest,
  TOTPInitResponse,
  TOTPRegenerateBackupRequest,
  TOTPStatusResponse,
  TOTPVerifyRequest,
  TOTPVerifyResponse,
  TrustedDevicesResponse,
} from './types';

/**
 * useLoginMutation — POST /auth/login.
 *
 * Returns the login response (access + refresh + user). Caller composes:
 *   1. login(...)
 *   2. fetch /users/me/keypair
 *   3. derive KEK, decrypt private_key
 *   4. authStore.setSession(...)
 *
 * Steps 2-4 stay outside this hook so the form can show a "deriving key"
 * spinner separately from the network call.
 */
export function useLoginMutation() {
  return useMutation({
    mutationFn: async (input: LoginRequest) =>
      apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: input,
        unauthenticated: true,
      }),
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: async () =>
      apiFetch<void>('/api/v1/auth/logout', {
        method: 'POST',
      }),
  });
}

export function useLogoutAllMutation() {
  return useMutation({
    mutationFn: async () =>
      apiFetch<void>('/api/v1/auth/logout-all', {
        method: 'POST',
      }),
  });
}

export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: async (input: ChangePasswordRequest) =>
      apiFetch<void>('/api/v1/auth/change-password', {
        method: 'POST',
        body: input,
      }),
  });
}

// --- TOTP (post-register / pre-active) ---

/**
 * /totp/init expects a bearer token in Authorization.
 * PR-SEC2: accepts either tmp_token (registration flow) or access_token (gate flow).
 * We use raw fetch to keep the token separate from the access-token slot in storage.
 */
export function useTOTPInitMutation() {
  return useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch('/api/v1/auth/totp/init', {
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

export function useTOTPVerifyMutation() {
  return useMutation({
    mutationFn: async (input: { token: string; code: string }) => {
      const res = await fetch('/api/v1/auth/totp/verify', {
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

// --- Recovery (forgot-password flow) ---

export function useRecoverInitMutation() {
  return useMutation({
    mutationFn: async (input: RecoverInitRequest) =>
      apiFetch<RecoverInitResponse>('/api/v1/auth/recover/init', {
        method: 'POST',
        body: input,
        unauthenticated: true,
      }),
  });
}

// --- TOTP management (PR-F2a) ---

export const totpStatusQueryKey = ['totp', 'status'] as const;

export function useTOTPStatusQuery() {
  return useQuery({
    queryKey: totpStatusQueryKey,
    queryFn: () => apiFetch<TOTPStatusResponse>('/api/v1/auth/totp/status'),
    staleTime: 30_000,
  });
}

export function useTOTPDisableMutation() {
  return useMutation({
    mutationFn: (input: TOTPDisableRequest) =>
      apiFetch<void>('/api/v1/auth/totp', {
        method: 'DELETE',
        body: input,
      }),
  });
}

export function useTOTPRegenerateBackupMutation() {
  return useMutation({
    mutationFn: (input: TOTPRegenerateBackupRequest) =>
      apiFetch<TOTPVerifyResponse>('/api/v1/auth/totp/backup-codes/regenerate', {
        method: 'POST',
        body: input,
      }),
  });
}

export function useRecoverCompleteMutation() {
  return useMutation({
    mutationFn: async (input: { tmpToken: string; body: RecoverCompleteRequest }) => {
      const res = await fetch('/api/v1/auth/recover/complete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.tmpToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Recovery complete hatası' }));
        throw new Error(body.message ?? `Recover complete: ${res.status}`);
      }
      return (await res.json()) as RecoverCompleteResponse;
    },
  });
}

// --- Trusted Devices (PR-F2b) ---

export const trustedDevicesQueryKey = ['trusted-devices'] as const;

export function useTrustedDevicesQuery() {
  return useQuery({
    queryKey: trustedDevicesQueryKey,
    queryFn: () => apiFetch<TrustedDevicesResponse>('/api/v1/auth/trusted-devices'),
    staleTime: 60_000,
  });
}

export function useRevokeTrustedDeviceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/auth/trusted-devices/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trustedDevicesQueryKey });
    },
  });
}

export function useRevokeAllTrustedDevicesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>('/api/v1/auth/trusted-devices', { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trustedDevicesQueryKey });
    },
  });
}

// --- PR-NOTIFY: Password Reset (Forgot Password) ---

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
  public_key: Uint8Array;
  private_key_enc: Uint8Array;
  kek_salt: Uint8Array;
  kek_params: Record<string, unknown>;
}

/**
 * POST /api/v1/auth/forgot-password
 * Always returns 200 OK (email enumeration protection).
 */
export function useForgotPasswordMutation() {
  return useMutation({
    mutationFn: async (input: ForgotPasswordRequest) =>
      apiFetch<{ message: string }>('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: input,
        unauthenticated: true,
      }),
  });
}

/**
 * POST /api/v1/auth/reset-password
 * Token from URL + new password + fresh E2E keypair.
 */
export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: async (input: ResetPasswordRequest) =>
      apiFetch<{ message: string }>('/api/v1/auth/reset-password', {
        method: 'POST',
        body: {
          token: input.token,
          new_password: input.new_password,
          public_key: Array.from(input.public_key),
          private_key_enc: Array.from(input.private_key_enc),
          kek_salt: Array.from(input.kek_salt),
          kek_params: input.kek_params,
        },
        unauthenticated: true,
      }),
  });
}
