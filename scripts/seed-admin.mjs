/**
 * Seed script — ilk admin kullanıcısını oluşturur.
 *
 * Kullanım:
 *   node scripts/seed-admin.mjs [SERVER_URL] [USERNAME] [PASSWORD]
 *
 * Örnek:
 *   node scripts/seed-admin.mjs http://localhost:8080 admin MyPassword123!
 */

import { webcrypto } from 'node:crypto';

// Node 20'de globalThis.crypto yoksa ata
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const SERVER  = process.argv[2] ?? 'http://localhost:8080';
const USERNAME = process.argv[3] ?? 'admin';
const PASSWORD = process.argv[4] ?? 'Admin1234567!';
const EMAIL    = `${USERNAME}@ironstock.local`;

// ── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function toB64(buf) {
  return Buffer.from(buf).toString('base64');
}
function fromB64(s) {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** X25519 anahtar çifti üret (32 byte public / private) */
async function generateX25519Keypair() {
  const keypair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveKey']);
  const pubRaw  = await crypto.subtle.exportKey('raw', keypair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', keypair.privateKey);
  // JWK'dan private key bytes (32 byte, base64url → base64)
  const privB64 = privJwk.d.replace(/-/g, '+').replace(/_/g, '/');
  const privRaw = fromB64(privB64);
  return { publicKey: new Uint8Array(pubRaw), privateKey: privRaw };
}

/** AES-GCM ile şifrele → nonce(12) || ciphertext */
async function aesGcmEncrypt(plaintext, key) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct    = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintext,
  );
  const out = new Uint8Array(1 + 1 + 12 + ct.byteLength);
  out[0] = 0x01; // version
  out[1] = 0x01; // alg AES-256-GCM
  out.set(nonce, 2);
  out.set(new Uint8Array(ct), 14);
  return out;
}

/** PBKDF2-SHA256 → KEK (AES-256-GCM) */
async function deriveKEK(password, salt, iterations = 210000) {
  const enc  = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** TOTP kodu üret (RFC 6238 / HMAC-SHA1) */
async function generateTOTP(base32Secret) {
  // base32 decode
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

  // HOTP counter = floor(time / 30)
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c >>>= 8; }

  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg));

  const offset = sig[19] & 0xf;
  const code = ((sig[offset] & 0x7f) << 24 | sig[offset+1] << 16 | sig[offset+2] << 8 | sig[offset+3]) % 1000000;
  return String(code).padStart(6, '0');
}

// ── Ana akış ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔑  IronStock Admin Seed`);
  console.log(`   Sunucu : ${SERVER}`);
  console.log(`   Kullanıcı adı : ${USERNAME}`);
  console.log(`   E-posta: ${EMAIL}\n`);

  // 1. Crypto material üret
  const kekSalt  = crypto.getRandomValues(new Uint8Array(16));
  const kekParams = { alg: 'pbkdf2-sha256', iterations: 210000 };
  const kek       = await deriveKEK(PASSWORD, kekSalt);

  const { publicKey, privateKey } = await generateX25519Keypair();
  const privateKeyEnc = await aesGcmEncrypt(privateKey, kek);

  // 2. Register
  console.log('1/4  Kayıt yapılıyor...');
  const regRes = await fetch(`${SERVER}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: USERNAME,
      email:    EMAIL,
      master_password: PASSWORD,
      public_key:      Array.from(publicKey),
      private_key_enc: Array.from(privateKeyEnc),
      kek_salt:        Array.from(kekSalt),
      kek_params:      kekParams,
    }),
  });
  if (!regRes.ok) {
    const err = await regRes.json().catch(() => ({}));
    console.error('❌  Kayıt başarısız:', err.message ?? regRes.status);
    process.exit(1);
  }
  const { tmp_token } = await regRes.json();
  console.log('   ✅ Kayıt OK — tmp_token alındı');

  // 3. TOTP init
  console.log('2/4  TOTP başlatılıyor...');
  const initRes = await fetch(`${SERVER}/api/v1/auth/totp/init`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tmp_token}` },
  });
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    console.error('❌  TOTP init başarısız:', err.message ?? initRes.status);
    process.exit(1);
  }
  const { otpauth_uri: totp_uri, secret_base32: secret } = await initRes.json();
  console.log('\n   ✅ TOTP secret üretildi!');
  console.log(`\n   📱 Secret (Authenticator uygulamasına elle gir):\n`);
  console.log(`      ${secret}\n`);
  console.log(`   veya otpauth URI:\n   ${totp_uri}\n`);

  // 4. TOTP verify — kodu secret'tan otomatik üret
  console.log('3/4  TOTP kodu hesaplanıyor...');
  const code = await generateTOTP(secret);
  const verRes = await fetch(`${SERVER}/api/v1/auth/totp/verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tmp_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  if (!verRes.ok) {
    const err = await verRes.json().catch(() => ({}));
    console.error('❌  TOTP verify başarısız:', err.message ?? verRes.status);
    process.exit(1);
  }
  console.log('   ✅ TOTP doğrulandı — hesap aktif!');

  // 5. Admin rol ata (doğrudan DB üzerinden)
  console.log('4/4  Admin rolü atanıyor (docker exec ile)...');
  const { execSync } = await import('node:child_process');
  const sql = `INSERT INTO user_roles (user_id, role)
    SELECT id, 'admin' FROM users WHERE username='${USERNAME}'
    ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role)
    SELECT id, 'write' FROM users WHERE username='${USERNAME}'
    ON CONFLICT DO NOTHING;`;
  try {
    execSync(
      `docker exec envanter-dev-postgres-1 psql -U envanter -d envanter -c "${sql}"`,
      { stdio: 'inherit' },
    );
    console.log('   ✅ Roller atandı (admin, write)');
  } catch {
    console.warn('   ⚠️  Rol atanamadı — manuel ekleyebilirsin:');
    console.warn(`   docker exec envanter-dev-postgres-1 psql -U envanter -d envanter -c "${sql}"`);
  }

  console.log(`\n✨  Hazır! Giriş bilgilerin:`);
  console.log(`   Kullanıcı adı : ${USERNAME}`);
  console.log(`   Parola        : ${PASSWORD}`);
  console.log(`   TOTP          : Authenticator uygulamasında`);
  console.log(`   Sunucu        : ${SERVER}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
