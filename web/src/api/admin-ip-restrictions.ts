/**
 * Admin IP restrictions API — PR-SEC5.
 *
 * GET  /api/v1/admin/users/{id}/ip-restrictions
 * PATCH /api/v1/admin/users/{id}/ip-restrictions
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface IPRestrictions {
  allowed_ip_cidrs: string[];
  allowed_country_codes: string[];
  deny_tor_exit: boolean;
}

export function useIPRestrictionsQuery(userId: string) {
  return useQuery({
    queryKey: ['admin', 'ip-restrictions', userId],
    queryFn: () =>
      apiFetch<IPRestrictions>(`/api/v1/admin/users/${userId}/ip-restrictions`),
    enabled: !!userId,
  });
}

export function useUpdateIPRestrictionsMutation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (restrictions: Partial<IPRestrictions>) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/ip-restrictions`, {
        method: 'PATCH',
        body: restrictions,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'ip-restrictions', userId] });
    },
  });
}
