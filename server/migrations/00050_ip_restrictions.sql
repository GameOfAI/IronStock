-- PR-SEC5: Per-user IP restrictions + GeoIP country filtering
-- Adds three columns to users for granular access control.

-- +goose Up

-- CIDR whitelist: empty array = allow all IPs (no restriction)
ALTER TABLE users ADD COLUMN allowed_ip_cidrs TEXT[] NOT NULL DEFAULT '{}';

-- ISO 3166-1 alpha-2 country codes: empty = allow all countries
ALTER TABLE users ADD COLUMN allowed_country_codes TEXT[] NOT NULL DEFAULT '{}';

-- Deny Tor exit nodes for this user
ALTER TABLE users ADD COLUMN deny_tor_exit BOOLEAN NOT NULL DEFAULT false;

-- +goose Down

ALTER TABLE users DROP COLUMN IF EXISTS deny_tor_exit;
ALTER TABLE users DROP COLUMN IF EXISTS allowed_country_codes;
ALTER TABLE users DROP COLUMN IF EXISTS allowed_ip_cidrs;
