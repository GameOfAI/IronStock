/**
 * Test fixtures — inventory data.
 */

import type { FieldDefinition, Folder, Item, ItemType } from '@/api/types';

export const sampleFolders: Folder[] = [
  {
    id: 'f-prod',
    parent_id: null,
    name: 'Production',
    position: 0,
    created_by: 'u1',
    created_at: '2026-04-20T10:00:00Z',
    updated_at: '2026-04-20T10:00:00Z',
    permission: 'write',
  },
  {
    id: 'f-stage',
    parent_id: null,
    name: 'Staging',
    position: 1,
    created_by: 'u1',
    created_at: '2026-04-20T10:00:00Z',
    updated_at: '2026-04-20T10:00:00Z',
    permission: 'read',
  },
];

export const sampleSubFolders: Folder[] = [
  {
    id: 'f-prod-db',
    parent_id: 'f-prod',
    name: 'Databases',
    position: 0,
    created_by: 'u1',
    created_at: '2026-04-20T11:00:00Z',
    updated_at: '2026-04-20T11:00:00Z',
    permission: 'write',
  },
];

export const sampleItems: Item[] = [
  {
    id: 'i-1',
    folder_id: 'f-prod',
    item_type_id: 3,
    name: 'mysql-prod',
    fields: [
      {
        field_definition_id: 1,
        value_enc: 'AAAA',
        value_nonce: 'BBBB',
        position: 0,
      },
      {
        field_definition_id: 2,
        value_enc: 'CCCC',
        value_nonce: 'DDDD',
        position: 1,
      },
    ],
    created_by: 'u1',
    created_at: '2026-04-21T08:00:00Z',
    updated_at: '2026-04-25T15:00:00Z',
    permission: 'write',
  },
  {
    id: 'i-2',
    folder_id: 'f-prod',
    item_type_id: 3,
    name: 'redis-prod',
    fields: [],
    created_by: 'u1',
    created_at: '2026-04-22T08:00:00Z',
    updated_at: '2026-04-22T08:00:00Z',
    permission: 'read',
  },
];

export const sampleItemTypes: ItemType[] = [
  { id: 1, key: 'server', label: 'Sunucu', icon: null, suggested_fields: [], default_launchers: [] },
  { id: 3, key: 'database', label: 'Veritabanı', icon: null, suggested_fields: [], default_launchers: [] },
];

export const sampleFieldDefinitions: FieldDefinition[] = [
  {
    id: 1,
    key: 'host',
    label: 'Host',
    field_type: 'text',
    is_secret: false,
    hint: null,
    validation_regex: null,
    allowed_values: null,
  },
  {
    id: 2,
    key: 'password',
    label: 'Parola',
    field_type: 'password',
    is_secret: true,
    hint: null,
    validation_regex: null,
    allowed_values: null,
  },
];
