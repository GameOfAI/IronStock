/**
 * Manuel TypeScript DTO'ları — server tarafındaki Go struct'larının
 * elle çevrilmiş karşılıkları. Faz 3 polish PR'ında oapi-codegen ile
 * üretilen `schema.gen.ts`'e taşınacak (ADR-0009 §1).
 *
 * Wire format kuralı: server `[]byte` alanlarını JSON'da base64 string
 * olarak gönderir. Bu DTO'larda `string` (base64-encoded) olarak typed.
 * Client component'i decode eder.
 */

// --- Errors ---

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// --- Auth ---

export interface RegisterRequest {
  username: string;
  email: string;
  master_password: string;
  public_key: string; // base64
  private_key_enc: string; // base64
  kek_salt: string; // base64
  kek_params: Record<string, unknown>;
}

export interface RegisterResponse {
  user_id: string;
  tmp_token: string;
}

export interface LoginRequest {
  username: string;
  master_password: string;
  totp_code: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  user_id: string;
  roles: string[];
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
}

export interface ChangePasswordRequest {
  current_master_password: string;
  new_master_password: string;
  new_private_key_enc: string; // base64
  new_kek_salt: string; // base64
  new_kek_params: Record<string, unknown>;
}

export interface RecoverInitRequest {
  username: string;
  recovery_code: string;
}
export interface RecoverInitResponse {
  tmp_token: string;
}

export interface RecoverCompleteRequest {
  new_master_password: string;
  public_key: string; // base64, 32B
  new_private_key_enc: string; // base64
  new_kek_salt: string; // base64
  new_kek_params: Record<string, unknown>;
}
export interface RecoverCompleteResponse {
  recovery_codes: string[];
}

export interface TOTPInitResponse {
  otpauth_uri: string;
  secret_base32: string;
}
export interface TOTPVerifyRequest {
  code: string;
}
export interface TOTPVerifyResponse {
  recovery_codes: string[];
}

// --- Folders ---

export type Permission = 'read' | 'write' | '';

export interface FolderRequest {
  name: string;
  parent_id?: string | null;
  position?: number;
}

export interface Folder {
  id: string;
  parent_id?: string | null;
  name: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  permission: Permission;
}

export interface FolderListResponse {
  folders: Folder[];
}

export interface GrantFolderPermissionRequest {
  user_id: string;
  permission: 'read' | 'write';
  inherit_to_children: boolean;
}

// --- Items ---

export interface ItemFieldInput {
  field_definition_id: number;
  value_enc?: string; // base64, omit when external_source backed
  value_nonce?: string; // base64, 12B
  position: number;
}

export interface ItemFieldOutput {
  field_definition_id: number;
  value_enc?: string;
  value_nonce?: string;
  position: number;
}

export interface ItemCreateRequest {
  id: string; // client-generated UUID v7
  folder_id: string;
  item_type_id: number;
  name: string;
  fields: ItemFieldInput[];
  owner_dek_wrapped: string; // base64, X25519 sealed-box
  owner_wrap_nonce: string; // base64, 12B
  external_source?: Record<string, unknown> | null;
}

export interface Item {
  id: string;
  folder_id: string;
  item_type_id: number;
  name: string;
  fields?: ItemFieldOutput[];
  created_by: string;
  created_at: string;
  updated_at: string;
  permission: Permission;
}

export interface ItemListResponse {
  items: Item[];
}

export interface ShareItemRequest {
  user_id: string;
  permission: 'read' | 'write';
  dek_wrapped: string; // base64
  wrap_nonce: string; // base64, 12B
}

// --- Admin ---

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  status: 'pending_totp' | 'active' | 'disabled' | 'locked';
  roles: string[];
  last_login_at?: string | null;
  created_at: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditLogEntry {
  id: number;
  actor_user_id?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: Record<string, unknown>;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditLogFilters {
  action?: string;
  actor_user_id?: string;
  resource_type?: string;
  resource_id?: string;
  from?: string; // RFC3339
  to?: string; // RFC3339
  limit?: number;
  offset?: number;
}

export interface GrantRoleRequest {
  role: 'admin' | 'write' | 'read';
}

// --- Catalog ---

export interface FieldDefinition {
  id: number;
  key: string;
  label: string;
  field_type:
    | 'text'
    | 'password'
    | 'url'
    | 'number'
    | 'boolean'
    | 'multiline'
    | 'ip'
    | 'port'
    | 'email'
    | 'ssh_key'
    | 'enum';
  is_secret: boolean;
  hint?: string | null;
  validation_regex?: string | null;
  allowed_values?: unknown[] | null;
}

export interface FieldDefinitionsResponse {
  field_definitions: FieldDefinition[];
}

export interface ItemType {
  id: number;
  key: string;
  label: string;
  icon?: string | null;
  suggested_fields: string[];
  default_launchers: unknown[];
}

export interface ItemTypesResponse {
  item_types: ItemType[];
}

export interface UserPublicKeyResponse {
  user_id: string;
  username: string;
  public_key: string; // base64, 32B X25519
}

export interface MyKeypairResponse {
  public_key: string; // base64
  private_key_enc: string; // base64
  kek_salt: string; // base64
  kek_params: Record<string, unknown>;
  version: number;
  rotated_at?: string | null;
}
