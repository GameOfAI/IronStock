/**
 * WebAuthn API hooks — PR-SEC4.
 *
 * Covers registration (add key), login (standalone WebAuthn flow),
 * and credential management (list, rename, delete).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WebAuthnCredential {
  id: string;
  label: string;
  transports: string[];
  created_at: string;
  last_used_at: string | null;
}

export interface WebAuthnLoginBeginResponse {
  options: object;
  session_key: string;
  user_id: string;
}

export interface WebAuthnRegisterBeginResponse {
  options: object;
  session_key: string;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

const waKeys = {
  credentials: ['webauthn', 'credentials'] as const,
};

// ─── Credential list ─────────────────────────────────────────────────────────

export function useWebAuthnCredentials() {
  return useQuery({
    queryKey: waKeys.credentials,
    queryFn: () =>
      apiFetch<{ credentials: WebAuthnCredential[] }>(
        '/api/v1/auth/webauthn/credentials',
      ),
    select: (data) => data.credentials,
  });
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** Step 1: get challenge options from server. */
export function useWebAuthnRegisterBeginMutation() {
  return useMutation({
    mutationFn: () =>
      apiFetch<WebAuthnRegisterBeginResponse>(
        '/api/v1/auth/webauthn/register/begin',
        { method: 'POST', body: {} },
      ),
  });
}

/** Step 2: send authenticator response + session_key + label to server. */
export function useWebAuthnRegisterFinishMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      session_key: string;
      label: string;
      credential: object;
    }) =>
      apiFetch('/api/v1/auth/webauthn/register/finish', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: waKeys.credentials });
    },
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────

/** Step 1: get assertion options from server (unauthenticated). */
export function useWebAuthnLoginBeginMutation() {
  return useMutation({
    mutationFn: (username: string) =>
      apiFetch<WebAuthnLoginBeginResponse>(
        '/api/v1/auth/webauthn/login/begin',
        { method: 'POST', body: { username }, unauthenticated: true },
      ),
  });
}

/** Step 2: send authenticator assertion to server, receive tokens. */
export function useWebAuthnLoginFinishMutation() {
  return useMutation({
    mutationFn: (payload: {
      user_id: string;
      session_key: string;
      credential: object;
    }) =>
      apiFetch<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
        user_id: string;
        roles: string[];
      }>('/api/v1/auth/webauthn/login/finish', {
        method: 'POST',
        body: payload,
        unauthenticated: true,
      }),
  });
}

// ─── Credential management ───────────────────────────────────────────────────

export function useWebAuthnUpdateCredentialMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      apiFetch(`/api/v1/auth/webauthn/credentials/${id}`, {
        method: 'PUT',
        body: { label },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: waKeys.credentials }),
  });
}

export function useWebAuthnDeleteCredentialMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/auth/webauthn/credentials/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: waKeys.credentials }),
  });
}
