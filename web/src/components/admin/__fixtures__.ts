/**
 * Test fixtures — admin data.
 */

import type { AdminUser, AuditLogEntry } from '@/api/types';

export const sampleUsers: AdminUser[] = [
  {
    id: 'u1',
    username: 'burak',
    email: 'burak@example.com',
    status: 'active',
    roles: ['admin', 'write'],
    last_login_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    is_break_glass: false,
  },
  {
    id: 'u2',
    username: 'alice',
    email: 'alice@example.com',
    status: 'pending_totp',
    roles: ['write'],
    last_login_at: null,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    is_break_glass: false,
  },
  {
    id: 'u3',
    username: 'bob',
    email: 'bob@example.com',
    status: 'disabled',
    roles: ['read'],
    last_login_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    is_break_glass: false,
  },
];

export const sampleAuditEntries: AuditLogEntry[] = [
  {
    id: 1001,
    actor_user_id: 'u1',
    action: 'auth.login',
    resource_type: null,
    resource_id: null,
    details: {},
    ip_address: '192.168.1.10',
    user_agent: 'Mozilla/5.0',
    created_at: new Date().toISOString(),
  },
  {
    id: 1002,
    actor_user_id: 'u1',
    action: 'admin.role_granted',
    resource_type: 'user',
    resource_id: '00000000-0000-0000-0000-000000000abc',
    details: { role: 'write' },
    ip_address: '192.168.1.10',
    user_agent: 'Mozilla/5.0',
    created_at: new Date(Date.now() - 60 * 1000).toISOString(),
  },
  {
    id: 1003,
    actor_user_id: null, // system
    action: 'auth.refresh',
    resource_type: 'session',
    resource_id: null,
    details: {},
    ip_address: null,
    user_agent: null,
    created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 1004,
    actor_user_id: 'u-deleted', // not in userMap → "silinmiş kullanıcı"
    action: 'item.created',
    resource_type: 'item',
    resource_id: '00000000-0000-0000-0000-000000000def',
    details: {},
    ip_address: null,
    user_agent: null,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
];
