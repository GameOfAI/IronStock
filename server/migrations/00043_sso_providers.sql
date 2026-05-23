-- PR-LDAP: SSO provider configuration + user identity linking.
--
-- Supports two provider types:
--   'oidc' — OpenID Connect (Azure AD, Okta, Google Workspace, …)
--   'ldap' — LDAP / Active Directory bind authentication
--
-- Secrets (client_secret, ldap_bind_password) are stored as AES-256-GCM
-- envelope-encrypted blobs (master key, versioned format from crypto.Seal).
-- The nonce is packed inside the blob — no separate nonce column needed.

-- +goose Up

CREATE TABLE sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,               -- human label: "Azure AD", "Internal LDAP"
    provider_type TEXT NOT NULL CHECK (provider_type IN ('oidc', 'ldap')),
    enabled BOOLEAN NOT NULL DEFAULT true,

    -- OIDC-specific --
    discovery_url TEXT,                      -- https://login.microsoftonline.com/{tenant}/v2.0
    client_id TEXT,
    client_secret_enc BYTEA,                 -- crypto.Seal blob (nonce packed, master-key encrypted)

    scopes TEXT[] NOT NULL DEFAULT '{"openid","email","profile"}',

    -- LDAP-specific --
    ldap_url TEXT,                           -- ldap://host:389  or  ldaps://host:636
    ldap_bind_dn TEXT,                       -- service-account DN
    ldap_bind_password_enc BYTEA,            -- crypto.Seal blob (nonce packed, master-key encrypted)

    ldap_user_search_base TEXT,              -- dc=example,dc=com
    ldap_user_filter TEXT NOT NULL DEFAULT '(uid={username})',
    ldap_attr_username TEXT NOT NULL DEFAULT 'uid',
    ldap_attr_email TEXT NOT NULL DEFAULT 'mail',
    ldap_attr_display_name TEXT NOT NULL DEFAULT 'cn',
    ldap_use_starttls BOOLEAN NOT NULL DEFAULT false,
    ldap_skip_tls_verify BOOLEAN NOT NULL DEFAULT false,

    -- Auto-provisioning --
    auto_provision BOOLEAN NOT NULL DEFAULT true,
    default_role TEXT NOT NULL DEFAULT 'read',  -- role to assign auto-provisioned users

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

-- Link between a local IronStock user and their external SSO identity.
-- One user may have identities at multiple providers.
CREATE TABLE user_sso_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,      -- OIDC: sub claim; LDAP: uid attribute value
    external_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    UNIQUE (provider_id, external_id)
);
CREATE INDEX idx_user_sso_user ON user_sso_identities (user_id);

-- +goose Down

DROP TABLE IF EXISTS user_sso_identities;
DROP TABLE IF EXISTS sso_providers;
