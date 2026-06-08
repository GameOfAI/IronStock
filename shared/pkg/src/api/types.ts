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
  totp_code?: string;
  /** PR-F2b: when true + TOTP verified, server sets a 30-day trusted-device cookie. */
  remember_device?: boolean;
}

// --- Trusted Devices (PR-F2b) ---

export interface TrustedDevice {
  id: string;
  device_label?: string | null;
  last_used_at: string; // RFC 3339
  expires_at: string; // RFC 3339
  created_at: string; // RFC 3339
}

export interface TrustedDevicesResponse {
  devices: TrustedDevice[];
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  user_id: string;
  roles: string[];
  /** Admin tarafından oluşturulan veya ilk kurulumda seed edilen kullanıcılarda true.
   *  true olduğunda frontend /change-password'e yönlendirir ve şifre değiştirilinceye
   *  kadar diğer route'lara erişimi engeller. */
  must_change_password?: boolean;
  /** PR-SEC2: totp_required=true && !hasTOTP → tam oturum verilir ama frontend
   *  MustSetupTOTPGate aracılığıyla /totp/setup'a yönlendirir. Kullanıcı TOTP
   *  kurulumunu tamamlayınca gate kaldırılır ve /inventory'e geçilir.
   *  must_change_password=true iken bu alan false olur (önce şifre değişikliği). */
  must_setup_totp?: boolean;
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

export interface TOTPStatusResponse {
  enabled: boolean;
  recovery_code_count: number;
}

export interface TOTPDisableRequest {
  master_password: string;
}

export interface TOTPRegenerateBackupRequest {
  totp_code: string;
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
  description?: string;
  fields: ItemFieldInput[];
  owner_dek_wrapped: string; // base64, X25519 sealed-box
  owner_wrap_nonce: string; // base64, 12B
  external_source?: Record<string, unknown> | null;
  /** RFC 3339 timestamp; null / omit to clear expiry (PR-N1). */
  expires_at?: string | null;
  /** "Rotate every N days" policy; null / omit to clear (PR-N1). */
  rotation_interval_days?: number | null;
}

export interface ItemUpdateRequest {
  name: string;
  description?: string;
  /** RFC 3339 timestamp; null to clear expiry (PR-N1). */
  expires_at?: string | null;
  /** "Rotate every N days" policy; null to clear (PR-N1). */
  rotation_interval_days?: number | null;
  /** When present, fully replaces all encrypted field values (replace-all semantics). */
  fields?: ItemFieldInput[];
  /** Re-wrapped DEK for the owner (required when fields are updated). */
  owner_dek_wrapped?: string;
  owner_wrap_nonce?: string;
}

export interface Item {
  id: string;
  folder_id: string;
  item_type_id: number;
  name: string;
  description?: string;
  fields?: ItemFieldOutput[];
  created_by: string;
  created_at: string;
  updated_at: string;
  permission: Permission;
  /** PR-13 sonrası sunucu tarafından doldurulur. Yoksa client decrypt edemez. */
  owner_dek_wrapped?: string;
  owner_wrap_nonce?: string;
  /** Credential expiry / rotation (PR-N1). */
  expires_at?: string | null;
  rotation_interval_days?: number | null;
  last_rotated_at?: string | null;
  /** PR-VAULT: external secret backend source config. Present for Vault-backed items. */
  external_source?: Record<string, unknown> | null;
  /** PR-N3: When true, non-owners must request access to view secret fields. */
  requires_approval?: boolean;
  /** PR-N3: Present when requires_approval=true and caller has no active approved request. */
  my_access_request?: AccessRequestInfo | null;
}

export interface ItemListResponse {
  items: Item[];
}

/** One snapshot of a field's encrypted value (PR-N2). Server stores opaque blobs. */
export interface FieldVersionOutput {
  version_number: number;
  value_enc?: string; // base64
  value_nonce?: string; // base64, 12B
  changed_at: string; // RFC 3339
}

export interface FieldVersionsResponse {
  versions: FieldVersionOutput[];
}

export interface ShareItemRequest {
  user_id: string;
  permission: 'read' | 'write';
  dek_wrapped: string; // base64
  wrap_nonce: string; // base64, 12B
  /** PR-TIME: optional time window. ISO 8601. NULL = no bound. */
  valid_from?: string | null;
  valid_until?: string | null;
}

// --- Group shares (PR-GROUP-SHARE) ---

/** One group member's wrapped DEK inside a ShareGroupRequest. */
export interface GroupShareMemberDEK {
  user_id: string;
  dek_wrapped: string; // base64
  wrap_nonce: string;  // base64, 12B
}

export interface ShareGroupRequest {
  group_id: string;
  permission: 'read' | 'write';
  /** Per-member DEK wraps. Client fetches all group members + public keys first. */
  members: GroupShareMemberDEK[];
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface ItemShareEntry {
  id: string;
  user_id: string;
  username: string;
  permission: 'read' | 'write';
  granted_by: string;
  granted_at: string;
  revoked_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface ItemGroupShareEntry {
  id: string;
  group_id: string;
  group_name: string;
  permission: 'read' | 'write';
  granted_by: string;
  granted_at: string;
  revoked_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface ItemSharesListResponse {
  users: ItemShareEntry[];
  groups: ItemGroupShareEntry[];
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
  is_break_glass: boolean; // PR-N4
  totp_required: boolean;       // PR-SEC1 — per-user TOTP enforcement
  requires_client_cert: boolean; // PR-SEC3 — per-user mTLS enforcement
  webauthn_required: boolean;   // PR-SEC4 — WebAuthn/FIDO2 enforcement
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

/** A group of related fields shown under a section header in the create-item form. */
export interface FieldGroup {
  name: string;
  fields: string[];
}

export interface ItemType {
  id: number;
  key: string;
  label: string;
  icon?: string | null;
  suggested_fields: string[];
  default_launchers: unknown[];
  /** When present, fields are rendered under named section headers (PR-F4). */
  field_groups?: FieldGroup[];
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

// --- Groups (PR-F6a) ---

export interface Group {
  id: string;
  name: string;
  description?: string | null;
  role?: 'admin' | 'write' | 'read' | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_count: number;
}

export interface GroupListResponse {
  groups: Group[];
  total: number;
}

export interface UpdateGroupRoleRequest {
  role: 'admin' | 'write' | 'read' | null;
}

export interface GroupMember {
  user_id: string;
  username: string;
  added_by?: string;
  added_at: string;
}

export interface GroupMembersResponse {
  members: GroupMember[];
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
}

export interface AddGroupMemberRequest {
  user_id: string;
}

export interface GrantFolderGroupPermissionRequest {
  folder_id: string;
  permission: 'read' | 'write';
  inherit_to_children: boolean;
}

export interface GroupFolderPermission {
  folder_id: string;
  folder_name: string;
  permission: 'read' | 'write';
  inherit_to_children: boolean;
  granted_at: string;
}

export interface GroupFolderPermissionsResponse {
  permissions: GroupFolderPermission[];
}

// --- Tags + Favorites (PR-N7) ---

export interface Tag {
  id: string;
  name: string;
  color?: string | null; // '#RRGGBB'
  created_by: string;
  created_at: string;
}

export interface TagListResponse {
  tags: Tag[];
}

export interface CreateTagRequest {
  name: string;
  color?: string | null;
}

export interface AddItemTagRequest {
  tag_id: string;
}

export interface ItemTagsResponse {
  tags: Tag[];
}

export interface FavoriteItem extends Item {
  pinned_at: string;
}

export interface FavoritesListResponse {
  items: FavoriteItem[];
}

// --- Notifications (PR-N8) ---

export interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  resource_type?: string;
  resource_id?: string;
  read_at?: string;
  created_at: string;
}

export interface NotificationsListResponse {
  notifications: Notification[];
  unread_count: number;
}

export interface UnreadCountResponse {
  unread_count: number;
}

// --- Graph / Pipeline Relationships (PR-F5a) ---

export type RelationshipType =
  | 'hosted_on'
  | 'accessed_via'
  | 'part_of'
  | 'related_to'
  | 'depends_on'
  | 'uses_tool'
  | 'builds_to'
  | 'scans_with'
  | 'deploys_to';

/** A graph node representing an item the caller can see. Name is decrypted server-side. */
export interface GraphNode {
  id: string;
  folder_id: string;
  item_type_id: number;
  /** Plaintext item name, decrypted server-side from the server-envelope. */
  name: string;
}

/** A directed edge between two items. */
export interface GraphEdge {
  source_id: string;
  target_id: string;
  type: RelationshipType;
  metadata?: Record<string, unknown>;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** item_id → list of lifecycle_stage_id values assigned to that item */
  lifecycle_stages: Record<string, number[]>;
}

export interface AddRelationshipRequest {
  target_id: string;
  type: RelationshipType;
  metadata?: Record<string, unknown>;
}

// --- Attachments (PR-A2) ---

export interface Attachment {
  id: string;
  item_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  is_encrypted: boolean;
  file_nonce?: string | null;
  upload_confirmed: boolean;
  created_by: string;
  created_at: string;
}

export interface AttachmentListResponse {
  attachments: Attachment[];
}

export interface AttachmentInitRequest {
  file_name: string;
  content_type: string;
  size_bytes: number;
  is_encrypted: boolean;
  file_nonce?: string;
}

export interface AttachmentInitResponse {
  attachment_id: string;
  upload_url: string;
  expires_at: string;
}

export interface AttachmentDownloadURLResponse {
  url: string;
  expires_at: string;
}

// --- One-Time Share Links (PR-N5) ---

/** Request body for POST /api/v1/items/{id}/share-links */
export interface CreateShareLinkRequest {
  /** Item DEK wrapped (AES-GCM) with the random link_key. base64-encoded. */
  dek_wrapped: string;
  /** TTL choice: "1h" | "1d" | "7d" */
  expires_in: '1h' | '1d' | '7d';
  /** Max times this link can be viewed (1–10). */
  view_limit: number;
}

/** Response body for POST /api/v1/items/{id}/share-links */
export interface CreateShareLinkResponse {
  /** The raw token to embed in the share URL path. */
  token: string;
  /** RFC 3339 expiry timestamp. */
  expires_at: string;
}

/** Row returned by GET /api/v1/items/{id}/share-links */
export interface ShareLink {
  id: string;
  expires_at: string; // RFC 3339
  view_limit: number;
  view_count: number;
  created_at: string; // RFC 3339
}

export interface ShareLinksListResponse {
  links: ShareLink[];
}

/** One encrypted field as returned by the public share view endpoint. */
export interface ShareLinkField {
  key: string;
  label: string;
  field_type: string;
  is_secret: boolean;
  /** base64-encoded ciphertext (only present for secret fields). */
  value_enc?: string | null;
  /** base64-encoded nonce (only present for secret fields). */
  value_nonce?: string | null;
}

/**
 * Response body for GET /api/v1/share/{token} — the public view endpoint.
 *
 * The server decrypts the item name (server-side envelope) and returns it in
 * plaintext. The field values remain client-encrypted with the item DEK.
 * The caller must derive the item DEK by decrypting `dek_wrapped` with the
 * `link_key` (taken from the URL fragment, never sent to the server).
 */
export interface ShareLinkViewResponse {
  /** Server-decrypted item name. */
  item_name: string;
  item_type_label: string;
  fields: ShareLinkField[];
  /** Item DEK wrapped with link_key — base64-encoded. */
  dek_wrapped: string;
  expires_at: string; // RFC 3339
  views_left: number;
}

// --- Lifecycle Stages (PR-F5c) ---

/** A single DevOps lifecycle stage (catalog entry). */
export interface LifecycleStage {
  id: number;
  key: string;
  label: string;
  sort_order: number;
  color: string;
}

/** Response for GET /api/v1/lifecycle-stages */
export interface LifecycleStagesResponse {
  stages: LifecycleStage[];
}

/** Response for GET /api/v1/items/{id}/lifecycle-stages */
export interface ItemLifecycleStagesResponse {
  stage_ids: number[];
}

/** Request body for POST /api/v1/items/{id}/lifecycle-stages */
export interface SetItemLifecycleStagesRequest {
  stage_ids: number[];
}

// --- Pipeline Diagrams (PR-F5d) ---

/** Diagram metadata (list view). */
export interface PipelineDiagramMeta {
  id: string;
  name: string;
  description?: string | null;
  folder_id?: string | null;
  layout_data: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** A node within a diagram (item + position). */
export interface PipelineDiagramNode {
  item_id: string;
  position_x?: number | null;
  position_y?: number | null;
  custom_label?: string | null;
}

/** Full diagram detail (meta + nodes). */
export interface PipelineDiagramDetail extends PipelineDiagramMeta {
  nodes: PipelineDiagramNode[];
}

export interface PipelineDiagramsListResponse {
  diagrams: PipelineDiagramMeta[];
}

export interface CreatePipelineDiagramRequest {
  name: string;
  description?: string;
  folder_id?: string;
}

export interface UpdatePipelineDiagramRequest {
  name?: string;
  description?: string;
}

export interface AddDiagramNodesRequest {
  item_ids: string[];
}

export interface SaveDiagramLayoutRequest {
  nodes: { item_id: string; position_x: number | null; position_y: number | null }[];
  viewport?: Record<string, unknown>;
}

/** Response for GET /pipeline-diagrams/{id}/graph */
export interface DiagramGraphNode {
  id: string;
  folder_id: string;
  item_type_id: number;
  name_enc: string;
  name_nonce: string;
  server_dek_wrapped: string;
  master_key_id: number;
  position_x?: number | null;
  position_y?: number | null;
  custom_label?: string | null;
}

export interface DiagramGraphEdge {
  source_id: string;
  target_id: string;
  type: RelationshipType;
  metadata?: Record<string, unknown>;
}

export interface DiagramGraphResponse {
  nodes: DiagramGraphNode[];
  edges: DiagramGraphEdge[];
  lifecycle_stages: Record<string, number[]>;
}

// --- Client Certificates (PR-SEC3) ---

export interface ClientCertCA {
  id: string;
  name: string;
  cert_pem: string;
  is_builtin: boolean;
  created_at: string; // RFC 3339
  created_by?: string | null; // user id
}

export interface ClientCertCAListResponse {
  cas: ClientCertCA[];
}

export interface UploadCARequest {
  name: string;
  cert_pem: string;
}

export interface ClientCertificate {
  id: string;
  ca_id: string;
  ca_name: string;
  fingerprint_sha256: string; // hex-encoded
  subject_cn: string;
  serial_number: string;
  not_before: string; // RFC 3339
  not_after: string;  // RFC 3339
  revoked_at?: string | null; // RFC 3339
  label?: string | null;
  created_at: string; // RFC 3339
}

export interface ClientCertListResponse {
  certs: ClientCertificate[];
}

export interface IssueCertRequest {
  label?: string;
  valid_for_days?: number;
}

/** IssueCertResponse extends ClientCertificate with the one-time PEM payload. */
export interface IssueCertResponse extends ClientCertificate {
  cert_pem: string;
  key_pem: string;
}

export interface RegisterCertRequest {
  cert_pem: string;
  ca_id: string;
  label?: string;
}

export interface CertRequiredRequest {
  required: boolean;
}

// ─── Log Forwarding (PR-LOG1 + PR-SIEM) ─────────────────────────────────────

export type LogForwardingTargetType = 'syslog' | 'slack' | 'splunk' | 'elastic';

export interface SyslogConfig {
  protocol: 'udp' | 'tcp';
  host: string;
  port?: number;
  app_name?: string;
}

export interface SlackConfig {
  webhook_url: string;
  channel?: string;
  username?: string;
}

/** PR-SIEM: Splunk HTTP Event Collector config. */
export interface SplunkConfig {
  url: string;
  token: string;
  index?: string;
  source?: string;
  source_type?: string;
  tls_insecure_skip_verify?: boolean;
}

/** PR-SIEM: Elasticsearch / Elastic Cloud config (ECS format). */
export interface ElasticConfig {
  url: string;
  index?: string;
  api_key?: string;
  username?: string;
  password?: string;
  tls_insecure_skip_verify?: boolean;
}

export type AnyForwardingConfig = SyslogConfig | SlackConfig | SplunkConfig | ElasticConfig;

export interface LogForwardingConfig {
  id: string;
  name: string;
  target_type: LogForwardingTargetType;
  enabled: boolean;
  config: AnyForwardingConfig;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface LogForwardingListResponse {
  configs: LogForwardingConfig[];
}

export interface CreateLogForwardingRequest {
  name: string;
  target_type: LogForwardingTargetType;
  enabled: boolean;
  config: AnyForwardingConfig;
}

export interface UpdateLogForwardingRequest {
  name?: string;
  enabled?: boolean;
  config?: AnyForwardingConfig;
}

// --- HashiCorp Vault Integration (PR-VAULT, ADR-0007) ---

/**
 * ExternalSourceVault is stored in items.external_source JSONB.
 * The server never persists or logs secret values — only this path metadata.
 */
export interface ExternalSourceVault {
  type: 'vault';
  mount: string;
  path: string;
  kv_version?: 1 | 2;
  /** Maps field_definition.key → vault data key */
  key_mapping: Record<string, string>;
  dynamic?: boolean;
  ttl?: number;
}

/**
 * One field value returned by POST /api/v1/items/{id}/vault-fetch.
 * Ephemeral — zero memory after display.
 */
export interface VaultFieldValue {
  field_key: string;
  value: string;
}

/** Response body of POST /api/v1/items/{id}/vault-fetch. */
export interface VaultFetchResponse {
  fields: VaultFieldValue[];
}

/** Response body of GET /api/v1/vault/paths (admin only). */
export interface VaultPathsResponse {
  paths: string[];
}

// --- Bulk Import (PR-IMPORT) ---

/** One parsed row returned by POST /api/v1/import/csv/preview. */
export interface CSVPreviewRow {
  index: number;
  raw_data: Record<string, string>;
}

/** Response body of POST /api/v1/import/csv/preview. */
export interface CSVPreviewResponse {
  headers: string[];
  rows: CSVPreviewRow[];
  total: number;
}

/** One item in a batch import request. Fields are already client-encrypted. */
export interface BatchImportItem {
  id: string;              // client-generated UUID v7
  folder_id: string;
  item_type_id: number;
  name: string;
  description?: string;
  fields: ItemFieldInput[];
  owner_dek_wrapped: string; // base64
  owner_wrap_nonce: string;  // base64, 12B
  expires_at?: string | null;
  rotation_interval_days?: number | null;
}

export interface BatchImportRequest {
  items: BatchImportItem[];
}

export interface BatchImportResponse {
  created: number;
  errors: string[];
}

// ---- Onay/Checkout Workflow (PR-N3) ----------------------------------------

export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

/** Embedded in Item when requires_approval=true and caller has no active access. */
export interface AccessRequestInfo {
  id: string;
  status: AccessRequestStatus;
  access_duration_minutes: number;
  requested_at: string;
  responded_at?: string | null;
  expires_at?: string | null;
  deny_reason?: string | null;
}

export interface AccessRequest {
  id: string;
  item_id: string;
  item_name?: string;
  requester_id: string;
  requester_name?: string;
  status: AccessRequestStatus;
  reason?: string | null;
  deny_reason?: string | null;
  access_duration_minutes: number;
  requested_at: string;
  responded_at?: string | null;
  approved_by?: string | null;
  expires_at?: string | null;
}

export interface AccessRequestsListResponse {
  requests: AccessRequest[];
}

export interface CreateAccessRequestRequest {
  reason?: string;
  access_duration_minutes: number;
}

export interface ApproveAccessRequestRequest {
  access_duration_minutes?: number;
}

export interface DenyAccessRequestRequest {
  reason: string;
}

export interface ToggleApprovalRequiredRequest {
  required: boolean;
}

// --- SSO/LDAP (PR-LDAP) ---

export type SSOProviderType = 'oidc' | 'ldap';

/** Public metadata for an SSO provider (no secrets). */
export interface SSOProviderInfo {
  id: string;
  name: string;
  provider_type: SSOProviderType;
}

/** Full admin view of an SSO provider (no secrets — booleans indicate presence). */
export interface SSOProvider {
  id: string;
  name: string;
  provider_type: SSOProviderType;
  enabled: boolean;
  // OIDC
  discovery_url?: string | null;
  client_id?: string | null;
  has_client_secret: boolean;
  scopes?: string[];
  // LDAP
  ldap_url?: string | null;
  ldap_bind_dn?: string | null;
  has_ldap_bind_password: boolean;
  ldap_user_search_base?: string | null;
  ldap_user_filter?: string;
  ldap_attr_username?: string;
  ldap_attr_email?: string;
  ldap_attr_display_name?: string;
  ldap_use_starttls: boolean;
  ldap_skip_tls_verify: boolean;
  // Provisioning
  auto_provision: boolean;
  default_role: string;
  created_at: string;
  updated_at: string;
}

export interface SSOProvidersListResponse {
  providers: SSOProviderInfo[];
}

export interface AdminSSOProvidersListResponse {
  providers: SSOProvider[];
}

export interface CreateSSOProviderRequest {
  name: string;
  provider_type: SSOProviderType;
  enabled: boolean;
  auto_provision: boolean;
  default_role: string;
  // OIDC
  discovery_url?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  // LDAP
  ldap_url?: string;
  ldap_bind_dn?: string;
  ldap_bind_password?: string;
  ldap_user_search_base?: string;
  ldap_user_filter?: string;
  ldap_attr_username?: string;
  ldap_attr_email?: string;
  ldap_attr_display_name?: string;
  ldap_use_starttls?: boolean;
  ldap_skip_tls_verify?: boolean;
}

export interface LDAPLoginRequest {
  provider_id: string;
  username: string;
  password: string;
}

export interface LDAPTestResult {
  ok: boolean;
  message?: string;
  error?: string;
}
