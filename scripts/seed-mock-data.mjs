#!/usr/bin/env node
/**
 * seed-mock-data.mjs — IronStock'a birbiriyle bağlantılı DevOps mock verisi oluşturur.
 *
 * Hedef: TÜM UI sekmelerini doldur:
 *   - Envanter (klasörler + item'lar)
 *   - Etiketler (tag'ler + item etiketleri)
 *   - İlişki Haritası (item'lar arası bağlantılar)
 *   - Pipeline Diyagramları (CI/CD akışı)
 *   - Lifecycle Lanes (DevOps yaşam döngüsü aşamaları)
 *
 * Kullanım:
 *   node scripts/seed-mock-data.mjs [SERVER_URL] [USERNAME] [PASSWORD] [TOTP_CODE]
 *
 * Örnek:
 *   node scripts/seed-mock-data.mjs http://localhost:3080 admin 'IronStock2026!' 123456
 */

import { webcrypto } from 'node:crypto';
import * as readline from 'node:readline';
import * as fs from 'node:fs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const SERVER   = process.argv[2] ?? 'http://localhost:3080';
const USERNAME = process.argv[3] ?? 'admin';
const PASSWORD = process.argv[4] ?? '';
const TOTP_ARG = process.argv[5] ?? '';

// ── Helpers ──────────────────────────────────────────────────────────────

function toB64(buf) { return Buffer.from(buf).toString('base64'); }
function fromB64(s) { return new Uint8Array(Buffer.from(s, 'base64')); }

function uuidv7() {
  const now = Date.now();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = (now / 2**40) & 0xff;
  bytes[1] = (now / 2**32) & 0xff;
  bytes[2] = (now / 2**24) & 0xff;
  bytes[3] = (now / 2**16) & 0xff;
  bytes[4] = (now / 2**8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function generateTOTP(base32Secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = base32Secret.toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0;
  const bytes = [];
  for (const c of s) {
    val = (val << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const key = new Uint8Array(bytes);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = new Uint8Array(8);
  let co = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = co & 0xff; co = Math.floor(co / 256); }
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg));
  const offset = sig[19] & 0xf;
  const code = ((sig[offset] & 0x7f) << 24 | sig[offset+1] << 16 | sig[offset+2] << 8 | sig[offset+3]) % 1000000;
  return String(code).padStart(6, '0');
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── Crypto ───────────────────────────────────────────────────────────────

const NONCE_LEN = 12;

function generateDEK() {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function sealDEK(dek, recipientPubKeyRaw) {
  const ephKP = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephKP.publicKey));
  const recipPubKey = await crypto.subtle.importKey('raw', recipientPubKeyRaw, { name: 'X25519' }, false, []);
  const sharedBits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'X25519', public: recipPubKey }, ephKP.privateKey, 256)
  );
  const wrapKey = await crypto.subtle.importKey('raw', sharedBits, 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, wrapKey, dek)
  );
  const wrapped = new Uint8Array(ephPubRaw.length + ctWithTag.length);
  wrapped.set(ephPubRaw);
  wrapped.set(ctWithTag, ephPubRaw.length);
  return { wrapped, nonce };
}

async function encryptField(value, dek) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(value))
  );
  return { valueEnc: ct, valueNonce: nonce };
}

// ── API client ───────────────────────────────────────────────────────────

let ACCESS_TOKEN = '';

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (ACCESS_TOKEN) headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`;
  const res = await fetch(`${SERVER}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg;
    try { const j = JSON.parse(text); msg = j.message || j.error || text; } catch { msg = text; }
    throw new Error(`API ${method} ${path} [${res.status}]: ${msg}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Field & Type IDs ─────────────────────────────────────────────────────

const F = {
  hostname: 1, ip_address: 2, port: 3, username: 4, password: 5,
  root_password: 6, ssh_port: 7, ssh_private_key: 8, ssh_passphrase: 9,
  fingerprint: 10, url: 11, host: 12, db_name: 13, db_type: 14,
  cpu: 15, ram_gb: 16, disk_gb: 17, os: 18, cert_pem: 19,
  private_key: 20, expires_at: 21, issuer: 22, provider: 23,
  access_key: 24, secret_key: 25, region: 26, account_id: 27,
  environment: 28, criticality: 29, notes: 30, ssl_mode: 31,
};

const T = {
  server: 1, url: 2, database: 3, ssh_key: 4,
  certificate: 5, cloud_credential: 6, note: 7, generic: 8, k8s_namespace: 9,
};

// Lifecycle stages: 1=Planlama, 2=Kaynak Kod, 3=Build, 4=Test, 5=Release, 6=Deploy, 7=Isletim, 8=Izleme

// ── Item creation ────────────────────────────────────────────────────────

async function createItem(pubKey, folderId, name, itemTypeId, fields, opts = {}) {
  const dek = generateDEK();
  const { wrapped, nonce } = await sealDEK(dek, pubKey);
  const encryptedFields = [];
  let pos = 0;
  for (const [fieldDefId, value] of fields) {
    const { valueEnc, valueNonce } = await encryptField(String(value), dek);
    encryptedFields.push({
      field_definition_id: fieldDefId,
      value_enc: toB64(valueEnc),
      value_nonce: toB64(valueNonce),
      position: pos++,
    });
  }
  const id = uuidv7();
  await api('POST', '/api/v1/items', {
    id, folder_id: folderId, item_type_id: itemTypeId, name,
    fields: encryptedFields,
    owner_dek_wrapped: toB64(wrapped),
    owner_wrap_nonce: toB64(nonce),
    ...opts,
  });
  return id;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== IronStock Mock Data Seeder (v2 — interconnected) ===');
  console.log(`    Server: ${SERVER}`);
  console.log(`    User:   ${USERNAME}\n`);

  const password = PASSWORD || await prompt('Master Parola: ');
  if (!password) { console.error('Parola gerekli'); process.exit(1); }

  // -- Login (with token caching) --
  const TOKEN_CACHE = '/tmp/ironstock-seed-token.json';
  let cachedToken = null;
  try {
    const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
    if (Date.now() - cached.ts < 10 * 60 * 1000) {
      cachedToken = cached;
      console.log('   (cached token)');
    }
  } catch { /* no cache */ }

  let totpCode = '';
  if (TOTP_ARG && /^\d{6,8}$/.test(TOTP_ARG)) {
    totpCode = TOTP_ARG;
  } else if (TOTP_ARG) {
    totpCode = await generateTOTP(TOTP_ARG);
  }

  let publicKey;
  if (cachedToken) {
    ACCESS_TOKEN = cachedToken.access_token;
    publicKey = fromB64(cachedToken.public_key);
  } else {
    // Login
    let loginRes;
    try {
      loginRes = await api('POST', '/api/v1/auth/login', {
        username: USERNAME, master_password: password,
        totp_code: totpCode || undefined,
      });
    } catch (err) {
      if (err.message.includes('mfa_required') || err.message.includes('MFA')) {
        if (!totpCode) totpCode = await prompt('TOTP Kodu: ');
        loginRes = await api('POST', '/api/v1/auth/login', {
          username: USERNAME, master_password: password, totp_code: totpCode,
        });
      } else throw err;
    }
    ACCESS_TOKEN = loginRes.access_token;
    console.log(`1. Login OK (user_id: ${loginRes.user_id})`);

    // Get public key
    const kp = await api('GET', '/api/v1/users/me/keypair');
    publicKey = fromB64(kp.public_key);

    // Cache
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
      access_token: loginRes.access_token,
      user_id: loginRes.user_id,
      public_key: kp.public_key,
      ts: Date.now(),
    }));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Create folders (flat structure — 5 folders total)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n2. Klasorler olusturuluyor...');

  const folderNames = ['Production', 'CI/CD Pipeline', 'Monitoring', 'Certificates & Keys', 'Cloud Accounts'];
  const folders = {};
  for (const name of folderNames) {
    const res = await api('POST', '/api/v1/folders', { name, parent_id: null });
    folders[name] = res.id;
    console.log(`   + ${name} (${res.id})`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Create tags
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n3. Etiketler olusturuluyor...');

  const tagDefs = [
    { name: 'critical',     color: '#EF4444' },
    { name: 'linux',        color: '#F97316' },
    { name: 'kubernetes',   color: '#326CE5' },
    { name: 'ci-cd',        color: '#E91E63' },
    { name: 'monitoring',   color: '#22C55E' },
    { name: 'auto-rotate',  color: '#A855F7' },
    { name: 'database',     color: '#3B82F6' },
    { name: 'ssl-tls',      color: '#14B8A6' },
  ];

  const tags = {};
  for (const t of tagDefs) {
    const res = await api('POST', '/api/v1/tags', t);
    tags[t.name] = res.id;
    console.log(`   # ${t.name} (${res.id})`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Create items — a realistic e-commerce DevOps stack
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n4. Item\'lar olusturuluyor...');

  const items = {};

  // Helper to create and log
  async function mkItem(key, folder, name, type, fields, opts) {
    const id = await createItem(publicKey, folders[folder], name, type, fields, opts);
    items[key] = id;
    console.log(`   [${key}] ${name} => ${id}`);
    return id;
  }

  // -- Production folder --
  await mkItem('nginx-lb', 'Production', 'Nginx Load Balancer', T.server, [
    [F.hostname,    'lb.prod.shopify-clone.internal'],
    [F.ip_address,  '10.0.1.10'],
    [F.ssh_port,    '22'],
    [F.username,    'deploy'],
    [F.password,    'LB-Pr0d#2026!nginx'],
    [F.os,          'Ubuntu 24.04 LTS'],
    [F.cpu,         '4 vCPU'],
    [F.ram_gb,      '8'],
    [F.disk_gb,     '100'],
    [F.environment, 'production'],
    [F.criticality, 'critical'],
    [F.notes,       'Reverse proxy. upstream: api-01, api-02. Rate limit: 1000 req/s'],
  ]);

  await mkItem('api-server', 'Production', 'API Server (Go)', T.server, [
    [F.hostname,    'api-01.prod.shopify-clone.internal'],
    [F.ip_address,  '10.0.2.11'],
    [F.ssh_port,    '2222'],
    [F.username,    'appuser'],
    [F.password,    'API-G0#Pr0d!2026$svc'],
    [F.os,          'Alpine Linux 3.20'],
    [F.cpu,         '16 vCPU'],
    [F.ram_gb,      '32'],
    [F.disk_gb,     '50'],
    [F.environment, 'production'],
    [F.criticality, 'critical'],
    [F.notes,       'Go 1.22 binary. gRPC + REST dual. Connects to pg-primary, redis-cache'],
  ]);

  await mkItem('pg-primary', 'Production', 'PostgreSQL Primary', T.database, [
    [F.host,        'pg-primary.prod.shopify-clone.internal'],
    [F.port,        '5432'],
    [F.db_name,     'shopify_prod'],
    [F.db_type,     'postgresql'],
    [F.username,    'app_rw'],
    [F.password,    'Pg-Pr0d#Mast3r!2026$'],
    [F.ssl_mode,    'verify-full'],
    [F.environment, 'production'],
    [F.criticality, 'critical'],
    [F.notes,       'Primary node. Streaming replication to pg-replica. WAL archiving to S3.'],
  ]);

  await mkItem('pg-replica', 'Production', 'PostgreSQL Replica', T.database, [
    [F.host,        'pg-replica.prod.shopify-clone.internal'],
    [F.port,        '5432'],
    [F.db_name,     'shopify_prod'],
    [F.db_type,     'postgresql'],
    [F.username,    'app_ro'],
    [F.password,    'Pg-R3pl#Read!2026'],
    [F.ssl_mode,    'verify-full'],
    [F.environment, 'production'],
    [F.criticality, 'high'],
    [F.notes,       'Hot standby. Read-only queries routed here via PgBouncer. Backup source.'],
  ]);

  await mkItem('redis-cache', 'Production', 'Redis Cache Cluster', T.database, [
    [F.host,        'redis.prod.shopify-clone.internal'],
    [F.port,        '6379'],
    [F.db_name,     '0'],
    [F.db_type,     'redis'],
    [F.password,    'R3d!s-Pr0d#2026!cache'],
    [F.environment, 'production'],
    [F.criticality, 'high'],
    [F.notes,       '3-node sentinel cluster. maxmemory 8GB, policy: allkeys-lfu. Session + product cache.'],
  ]);

  await mkItem('k8s-prod', 'Production', 'K8s Production Cluster', T.k8s_namespace, [
    [F.hostname,    'k8s-api.prod.shopify-clone.internal'],
    [F.port,        '6443'],
    [F.username,    'cluster-admin'],
    [F.password,    'K8s-Pr0d#Token!2026'],
    [F.environment, 'production'],
    [F.criticality, 'critical'],
    [F.notes,       '3 master + 5 worker. Namespace: default, backend, frontend, monitoring, ingress'],
  ]);

  // -- CI/CD Pipeline folder --
  await mkItem('gitlab', 'CI/CD Pipeline', 'GitLab Server', T.url, [
    [F.url,         'https://gitlab.shopify-clone.dev'],
    [F.username,    'devops-bot'],
    [F.password,    'GL-B0t#Tok3n!2026$'],
    [F.environment, 'production'],
    [F.criticality, 'critical'],
    [F.notes,       'Self-hosted GitLab EE. 15 active projects. CI runner: 4x Docker executor.'],
  ]);

  await mkItem('harbor', 'CI/CD Pipeline', 'Harbor Registry', T.url, [
    [F.url,         'https://harbor.shopify-clone.dev'],
    [F.username,    'ci-push'],
    [F.password,    'Harb0r#Push!2026$'],
    [F.environment, 'production'],
    [F.criticality, 'high'],
    [F.notes,       'Container image registry. Trivy vulnerability scanning enabled. Retention: 90 days.'],
  ]);

  await mkItem('argocd', 'CI/CD Pipeline', 'ArgoCD Dashboard', T.url, [
    [F.url,         'https://argocd.shopify-clone.dev'],
    [F.username,    'admin'],
    [F.password,    'Arg0#CD!Adm1n2026'],
    [F.environment, 'production'],
    [F.criticality, 'high'],
    [F.notes,       'GitOps deployment. Auto-sync: staging=on, prod=manual. 8 applications.'],
  ]);

  await mkItem('sonarqube', 'CI/CD Pipeline', 'SonarQube Scanner', T.url, [
    [F.url,         'https://sonar.shopify-clone.dev'],
    [F.username,    'ci-scanner'],
    [F.password,    'S0nar#Scan!2026'],
    [F.environment, 'production'],
    [F.criticality, 'medium'],
    [F.notes,       'Static code analysis. Quality gate: coverage>80%, duplications<3%, no critical bugs.'],
  ]);

  // -- Monitoring folder --
  await mkItem('grafana', 'Monitoring', 'Grafana Dashboard', T.url, [
    [F.url,         'https://grafana.shopify-clone.dev'],
    [F.username,    'admin'],
    [F.password,    'Graf#Adm1n!2026$'],
    [F.environment, 'production'],
    [F.criticality, 'high'],
    [F.notes,       '12 dashboards: API latency, DB connections, K8s pods, Redis hit ratio, error rate.'],
  ]);

  await mkItem('prometheus', 'Monitoring', 'Prometheus Server', T.server, [
    [F.hostname,    'prometheus.monitoring.shopify-clone.internal'],
    [F.ip_address,  '10.0.5.10'],
    [F.port,        '9090'],
    [F.username,    'admin'],
    [F.password,    'Prom#Adm1n!2026'],
    [F.os,          'Alpine Linux 3.20'],
    [F.cpu,         '4 vCPU'],
    [F.ram_gb,      '16'],
    [F.disk_gb,     '500'],
    [F.environment, 'production'],
    [F.criticality, 'high'],
    [F.notes,       'Retention: 30 days. 850 active targets. Alert rules: 47 active, 12 pending.'],
  ]);

  await mkItem('alertmanager', 'Monitoring', 'AlertManager', T.url, [
    [F.url,         'https://alertmanager.shopify-clone.dev'],
    [F.username,    'admin'],
    [F.password,    'Alert#Mgr!2026'],
    [F.environment, 'production'],
    [F.criticality, 'high'],
    [F.notes,       'Routes: critical->PagerDuty, warning->Slack#ops, info->email. Silence: maintenance windows.'],
  ]);

  // -- Certificates & Keys folder --
  await mkItem('wildcard-cert', 'Certificates & Keys', 'Wildcard SSL (*.shopify-clone.dev)', T.certificate, [
    [F.hostname,    '*.shopify-clone.dev'],
    [F.cert_pem,    '-----BEGIN CERTIFICATE-----\nMIIDmock...WildcardCert...NotReal\n-----END CERTIFICATE-----'],
    [F.private_key, '-----BEGIN EC PRIVATE KEY-----\nMIImock...WildcardKey...NotReal\n-----END EC PRIVATE KEY-----'],
    [F.expires_at,  '2027-06-15T00:00:00Z'],
    [F.issuer,      "Let's Encrypt"],
    [F.criticality, 'critical'],
    [F.notes,       'Auto-renew via certbot. Used by Nginx LB, Harbor, GitLab. 90-day rotation.'],
  ], { expires_at: '2027-06-15T00:00:00Z' });

  await mkItem('deploy-key', 'Certificates & Keys', 'Production Deploy SSH Key', T.ssh_key, [
    [F.hostname,    '*.prod.shopify-clone.internal'],
    [F.username,    'deploy'],
    [F.ssh_private_key, '-----BEGIN OPENSSH PRIVATE KEY-----\nmock-deploy-key-ed25519-not-real\n-----END OPENSSH PRIVATE KEY-----'],
    [F.ssh_passphrase, 'D3pl0y#K3y!Pr0d2026'],
    [F.fingerprint, 'SHA256:xR7kMock1234567890abcdefghijklmno'],
    [F.criticality, 'critical'],
    [F.notes,       'Access to all prod servers. Rotation: 90 days. Last rotated: 2026-04-01.'],
  ], { rotation_interval_days: 90 });

  await mkItem('k8s-sa-token', 'Certificates & Keys', 'K8s Service Account Token', T.generic, [
    [F.hostname,    'k8s-api.prod.shopify-clone.internal'],
    [F.username,    'ci-deployer'],
    [F.password,    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock-sa-token'],
    [F.criticality, 'high'],
    [F.notes,       'ServiceAccount for ArgoCD + GitLab CI. Roles: deploy to backend,frontend namespaces.'],
  ]);

  // -- Cloud Accounts folder --
  await mkItem('aws-prod', 'Cloud Accounts', 'AWS Production Account', T.cloud_credential, [
    [F.provider,    'aws'],
    [F.access_key,  'AKIAIOSFODNN7MOCK001'],
    [F.secret_key,  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYMOCK'],
    [F.region,      'eu-central-1'],
    [F.account_id,  '123456789012'],
    [F.environment, 'production'],
    [F.criticality, 'critical'],
    [F.notes,       'Terraform + CI/CD only. S3, RDS, ECR, CloudFront. Monthly cost: ~$2400.'],
  ], { rotation_interval_days: 90 });

  await mkItem('cloudflare', 'Cloud Accounts', 'Cloudflare DNS & WAF', T.url, [
    [F.url,         'https://dash.cloudflare.com'],
    [F.username,    'ops@shopify-clone.dev'],
    [F.password,    'CF#Dash!Pr0d2026$'],
    [F.environment, 'production'],
    [F.criticality, 'critical'],
    [F.notes,       'Zone: shopify-clone.dev. Full SSL, WAF on, Rate limiting: 2000 req/min. DDoS protection.'],
  ]);

  await mkItem('sentry', 'Cloud Accounts', 'Sentry Error Tracking', T.url, [
    [F.url,         'https://sentry.io/organizations/shopify-clone/'],
    [F.username,    'ops@shopify-clone.dev'],
    [F.password,    'S3ntry#0ps!2026'],
    [F.environment, 'production'],
    [F.criticality, 'medium'],
    [F.notes,       'Error tracking for API + frontend. 3 projects. Alerts: Slack + PagerDuty.'],
  ]);

  const itemCount = Object.keys(items).length;
  console.log(`   Toplam: ${itemCount} item\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 5: Tag items
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('5. Etiketler ataniyor...');

  const tagAssignments = {
    'critical':    ['nginx-lb', 'api-server', 'pg-primary', 'k8s-prod', 'wildcard-cert', 'deploy-key', 'aws-prod', 'cloudflare', 'gitlab'],
    'linux':       ['nginx-lb', 'api-server', 'prometheus'],
    'kubernetes':  ['k8s-prod', 'argocd', 'k8s-sa-token', 'harbor'],
    'ci-cd':       ['gitlab', 'harbor', 'argocd', 'sonarqube', 'k8s-sa-token'],
    'monitoring':  ['grafana', 'prometheus', 'alertmanager', 'sentry'],
    'auto-rotate': ['deploy-key', 'aws-prod', 'wildcard-cert'],
    'database':    ['pg-primary', 'pg-replica', 'redis-cache'],
    'ssl-tls':     ['wildcard-cert', 'nginx-lb', 'cloudflare'],
  };

  let tagCount = 0;
  for (const [tagName, itemKeys] of Object.entries(tagAssignments)) {
    for (const key of itemKeys) {
      try {
        await api('POST', `/api/v1/items/${items[key]}/tags`, { tag_id: tags[tagName] });
        tagCount++;
      } catch (err) {
        console.error(`   ! Tag ${tagName} -> ${key}: ${err.message}`);
      }
    }
  }
  console.log(`   ${tagCount} etiket atandi\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6: Create relationships (the graph)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('6. Iliskiler olusturuluyor...');

  const relationships = [
    // Infrastructure dependencies
    ['api-server',    'nginx-lb',      'accessed_via'],   // API behind nginx
    ['api-server',    'pg-primary',    'depends_on'],     // API uses postgres
    ['api-server',    'redis-cache',   'depends_on'],     // API uses redis
    ['pg-replica',    'pg-primary',    'depends_on'],     // replica syncs from primary
    ['api-server',    'k8s-prod',      'runs_in'],        // API runs in K8s
    ['nginx-lb',      'k8s-prod',      'runs_in'],        // nginx in K8s
    ['redis-cache',   'k8s-prod',      'runs_in'],        // redis in K8s

    // CI/CD flow
    ['gitlab',        'sonarqube',     'uses_tool'],      // GitLab uses SonarQube
    ['gitlab',        'harbor',        'builds_to'],      // GitLab pushes images to Harbor
    ['argocd',        'k8s-prod',      'deploys_to'],     // ArgoCD deploys to K8s
    ['argocd',        'harbor',        'depends_on'],     // ArgoCD pulls from Harbor
    ['k8s-sa-token',  'k8s-prod',      'accessed_via'],   // SA token accesses K8s

    // Monitoring
    ['grafana',       'prometheus',    'depends_on'],     // Grafana queries Prometheus
    ['alertmanager',  'prometheus',    'depends_on'],     // AlertManager gets alerts from Prometheus
    ['prometheus',    'api-server',    'scans_with'],     // Prometheus scrapes API metrics
    ['prometheus',    'pg-primary',    'scans_with'],     // Prometheus scrapes PG exporter
    ['prometheus',    'redis-cache',   'scans_with'],     // Prometheus scrapes Redis exporter
    ['prometheus',    'k8s-prod',      'scans_with'],     // Prometheus scrapes K8s
    ['sentry',        'api-server',    'scans_with'],     // Sentry monitors API errors

    // Certificates
    ['wildcard-cert', 'nginx-lb',      'related_to'],     // cert used by nginx
    ['wildcard-cert', 'harbor',        'related_to'],     // cert used by harbor
    ['wildcard-cert', 'gitlab',        'related_to'],     // cert used by gitlab
    ['deploy-key',    'api-server',    'accessed_via'],   // deploy key for API server
    ['deploy-key',    'nginx-lb',      'accessed_via'],   // deploy key for LB

    // Cloud
    ['aws-prod',      'pg-primary',    'related_to'],     // RDS hosted on AWS
    ['cloudflare',    'nginx-lb',      'related_to'],     // Cloudflare fronts nginx
  ];

  let relCount = 0;
  for (const [src, tgt, type] of relationships) {
    try {
      await api('POST', `/api/v1/items/${items[src]}/relationships`, {
        target_id: items[tgt],
        type,
      });
      relCount++;
    } catch (err) {
      console.error(`   ! ${src} -[${type}]-> ${tgt}: ${err.message}`);
    }
  }
  console.log(`   ${relCount} iliski olusturuldu\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 7: Lifecycle stages
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('7. Lifecycle stage\'ler ataniyor...');

  // Each item gets relevant lifecycle stages
  // 1=Planlama, 2=Kaynak Kod, 3=Build, 4=Test, 5=Release, 6=Deploy, 7=Isletim, 8=Izleme
  const lifecycleMap = {
    'nginx-lb':      [5, 6, 7, 8],        // Release → Deploy → Operate → Monitor
    'api-server':    [1, 2, 3, 4, 5, 6, 7, 8], // Full lifecycle
    'pg-primary':    [1, 6, 7, 8],         // Plan → Deploy → Operate → Monitor
    'pg-replica':    [6, 7, 8],            // Deploy → Operate → Monitor
    'redis-cache':   [6, 7, 8],            // Deploy → Operate → Monitor
    'k8s-prod':      [1, 6, 7, 8],         // Plan → Deploy → Operate → Monitor
    'gitlab':        [2, 3],               // Source Code → Build (it's the CI tool)
    'harbor':        [3, 5],               // Build → Release (image registry)
    'argocd':        [5, 6],               // Release → Deploy (GitOps)
    'sonarqube':     [2, 4],               // Source Code → Test (code analysis)
    'grafana':       [7, 8],               // Operate → Monitor
    'prometheus':    [7, 8],               // Operate → Monitor
    'alertmanager':  [7, 8],               // Operate → Monitor
    'wildcard-cert': [6, 7],               // Deploy → Operate
    'deploy-key':    [6, 7],               // Deploy → Operate
    'k8s-sa-token':  [6],                  // Deploy
    'aws-prod':      [1, 6, 7],            // Plan → Deploy → Operate
    'cloudflare':    [6, 7, 8],            // Deploy → Operate → Monitor
    'sentry':        [4, 7, 8],            // Test → Operate → Monitor
  };

  let lcCount = 0;
  for (const [key, stageIds] of Object.entries(lifecycleMap)) {
    try {
      await api('POST', `/api/v1/items/${items[key]}/lifecycle-stages`, { stage_ids: stageIds });
      lcCount++;
    } catch (err) {
      console.error(`   ! ${key} lifecycle: ${err.message}`);
    }
  }
  console.log(`   ${lcCount} item icin lifecycle atandi\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 8: Pipeline diagrams
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('8. Pipeline diyagramlari olusturuluyor...');

  // Diagram 1: CI/CD Pipeline — full flow
  const cicdDiagram = await api('POST', '/api/v1/pipeline-diagrams', {
    name: 'CI/CD Deployment Pipeline',
    description: 'GitLab commit -> SonarQube scan -> Harbor image -> ArgoCD deploy -> K8s production',
  });
  console.log(`   Pipeline 1: ${cicdDiagram.id}`);

  // Add nodes to CI/CD diagram
  const cicdNodes = ['gitlab', 'sonarqube', 'harbor', 'argocd', 'k8s-prod', 'api-server'];
  await api('POST', `/api/v1/pipeline-diagrams/${cicdDiagram.id}/nodes`, {
    item_ids: cicdNodes.map(k => items[k]),
  });

  // Layout: left to right flow
  await api('PUT', `/api/v1/pipeline-diagrams/${cicdDiagram.id}/layout`, {
    nodes: [
      { item_id: items['gitlab'],     position_x: 100,  position_y: 200 },
      { item_id: items['sonarqube'],   position_x: 300,  position_y: 100 },
      { item_id: items['harbor'],      position_x: 300,  position_y: 300 },
      { item_id: items['argocd'],      position_x: 500,  position_y: 200 },
      { item_id: items['k8s-prod'],    position_x: 700,  position_y: 200 },
      { item_id: items['api-server'],  position_x: 900,  position_y: 200 },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  console.log('   Layout saved: CI/CD flow (6 nodes)');

  // Diagram 2: Production Infrastructure
  const infraDiagram = await api('POST', '/api/v1/pipeline-diagrams', {
    name: 'Production Infrastructure',
    description: 'Cloudflare -> Nginx LB -> API Server -> PostgreSQL + Redis (with monitoring)',
  });
  console.log(`   Pipeline 2: ${infraDiagram.id}`);

  const infraNodes = ['cloudflare', 'nginx-lb', 'api-server', 'pg-primary', 'pg-replica', 'redis-cache', 'prometheus', 'grafana'];
  await api('POST', `/api/v1/pipeline-diagrams/${infraDiagram.id}/nodes`, {
    item_ids: infraNodes.map(k => items[k]),
  });

  await api('PUT', `/api/v1/pipeline-diagrams/${infraDiagram.id}/layout`, {
    nodes: [
      { item_id: items['cloudflare'],  position_x: 100,  position_y: 250 },
      { item_id: items['nginx-lb'],    position_x: 300,  position_y: 250 },
      { item_id: items['api-server'],  position_x: 500,  position_y: 250 },
      { item_id: items['pg-primary'],  position_x: 700,  position_y: 150 },
      { item_id: items['pg-replica'],  position_x: 900,  position_y: 150 },
      { item_id: items['redis-cache'], position_x: 700,  position_y: 350 },
      { item_id: items['prometheus'],  position_x: 500,  position_y: 450 },
      { item_id: items['grafana'],     position_x: 700,  position_y: 450 },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  console.log('   Layout saved: Infra topology (8 nodes)\n');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DONE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('=== TAMAMLANDI ===');
  console.log(`  ${itemCount} item`);
  console.log(`  ${Object.keys(folders).length} klasor`);
  console.log(`  ${Object.keys(tags).length} etiket`);
  console.log(`  ${tagCount} etiket atamasi`);
  console.log(`  ${relCount} iliski`);
  console.log(`  ${lcCount} lifecycle atamasi`);
  console.log(`  2 pipeline diyagrami`);
  console.log('');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
