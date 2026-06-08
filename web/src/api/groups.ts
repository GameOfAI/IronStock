import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  AddGroupMemberRequest,
  CreateGroupRequest,
  Group,
  GroupListResponse,
  GroupMembersResponse,
  GroupFolderPermissionsResponse,
  GrantFolderGroupPermissionRequest,
  UpdateGroupRoleRequest,
} from './types';

export const groupsQueryKey = ['admin', 'groups'] as const;
export const groupQueryKey = (id: string) => ['admin', 'groups', id] as const;
export const groupMembersQueryKey = (id: string) => ['admin', 'groups', id, 'members'] as const;
export const groupFolderPermsQueryKey = (id: string) => ['admin', 'groups', id, 'folder-permissions'] as const;

// --- Queries ---

export function useGroupsQuery() {
  return useQuery({
    queryKey: groupsQueryKey,
    queryFn: () => apiFetch<GroupListResponse>('/api/v1/admin/groups'),
    staleTime: 30_000,
  });
}

export function useGroupQuery(id: string) {
  return useQuery({
    queryKey: groupQueryKey(id),
    queryFn: () => apiFetch<Group>(`/api/v1/admin/groups/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useGroupMembersQuery(groupId: string) {
  return useQuery({
    queryKey: groupMembersQueryKey(groupId),
    queryFn: () => apiFetch<GroupMembersResponse>(`/api/v1/admin/groups/${groupId}/members`),
    enabled: Boolean(groupId),
    staleTime: 15_000,
  });
}

export function useGroupFolderPermissionsQuery(groupId: string) {
  return useQuery({
    queryKey: groupFolderPermsQueryKey(groupId),
    queryFn: () =>
      apiFetch<GroupFolderPermissionsResponse>(`/api/v1/admin/groups/${groupId}/folder-permissions`),
    enabled: Boolean(groupId),
    staleTime: 15_000,
  });
}

// --- Mutations ---

export function useCreateGroupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupRequest) =>
      apiFetch<Group>('/api/v1/admin/groups', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsQueryKey }),
  });
}

export function useDeleteGroupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/admin/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsQueryKey }),
  });
}

export function useUpdateGroupRoleMutation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGroupRoleRequest) =>
      apiFetch<void>(`/api/v1/admin/groups/${groupId}/role`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: groupsQueryKey });
      qc.invalidateQueries({ queryKey: groupQueryKey(groupId) });
    },
  });
}

export function useAddGroupMemberMutation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddGroupMemberRequest) =>
      apiFetch<void>(`/api/v1/admin/groups/${groupId}/members`, { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: groupMembersQueryKey(groupId) });
      qc.invalidateQueries({ queryKey: groupQueryKey(groupId) });
    },
  });
}

export function useRemoveGroupMemberMutation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/api/v1/admin/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: groupMembersQueryKey(groupId) });
      qc.invalidateQueries({ queryKey: groupQueryKey(groupId) });
    },
  });
}

export function useGrantFolderGroupPermissionMutation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GrantFolderGroupPermissionRequest) =>
      apiFetch<void>(`/api/v1/admin/groups/${groupId}/folder-permissions`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupFolderPermsQueryKey(groupId) }),
  });
}

export function useRevokeFolderGroupPermissionMutation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) =>
      apiFetch<void>(`/api/v1/admin/groups/${groupId}/folder-permissions/${folderId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupFolderPermsQueryKey(groupId) }),
  });
}
