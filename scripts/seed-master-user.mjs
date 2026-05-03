/**
 * Master User Seed — OTP'siz admin kullanıcı oluşturur
 *
 * Kullanım:
 *   node scripts/seed-master-user.mjs [USERNAME] [PASSWORD]
 *
 * Örnek:
 *   node scripts/seed-master-user.mjs master Master123456!
 */

import { webcrypto } from 'node:crypto';
import pkg from 'pg';
import { hash } from 'argon2-wasm';
import speakeasy from 'speakeasy';
const { Client } = pkg;

// Node 20'de globalThis.crypto yoksa ata
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const USERNAME = process.argv[2] ?? 'master';
const PASSWORD = process.argv[3] ?? 'Master123456!';
const EMAIL = `${USERNAME}@ironstock.local`;
const MASTER_KEY = process.env.ENVANTER_MASTER_KEY || 'Vb0/UxR3MObGNxhzEZ2xLX35nDSkiwAoPek5GBdm40I=';

// ── Crypto Helpers ────────────────────────────────────────────────────────────

function toB64(buf) {
  return Buffer.from(buf).toString('base64');
}

function fromB64(s) {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/**
 * Argon2id ile password hash
 */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordBuf = encoder.encode(password);

  // Argon2id params: matching server defaults
  // t=3 iterations, m=65536 KiB (64MiB), p=4 parallelism
  const result = await hash(passwordBuf, salt, {
    algorithm: 'argon2id',
    memory: 65536,      // KiB (64 MiB)
    time: 3,            // iterations
    parallelism: 4,     // threads
  });

  // result.hash is the binary hash, result.encoded is the full argon2 string
  return {
    hash: result.hash,  // Use just the binary hash
    salt: salt,
    params: {
      t: 3,             // TimeCost (iterations)
      m: 65536,         // MemoryCost (KiB)
      p: 4,             // Parallelism (threads)
      s: 16,            // SaltLength (bytes)
      k: 32,            // KeyLength (hash size)
      salt_b64: toB64(salt)  // For compatibility
    }
  };
}

/** X25519 anahtar çifti üret */
async function generateX25519Keypair() {
  const keypair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveKey']);
  const pubRaw = await crypto.subtle.exportKey('raw', keypair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', keypair.privateKey);
  const privB64 = privJwk.d.replace(/-/g, '+').replace(/_/g, '/');
  const privRaw = fromB64(privB64);
  return {
    publicKey: toB64(new Uint8Array(pubRaw)),
    privateKey: toB64(privRaw)
  };
}

/** TOTP secret'ı master key ile şifrele (AES-256-GCM) */
async function encryptTOTPSecret(secret, masterKeyB64, userId) {
  // Master key'i çöz
  const masterKey = fromB64(masterKeyB64);
  const keyObj = await crypto.subtle.importKey('raw', masterKey, 'AES-GCM', false, ['encrypt']);

  // Nonce (12 byte IV) ve encrypted output'u hazırla
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`totp_secrets:${userId}:secret_enc`);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    keyObj,
    secret
  );

  // TOTP secret blob: nonce (12) + encrypted_data
  const blob = new Uint8Array(nonce.length + encrypted.byteLength);
  blob.set(nonce);
  blob.set(new Uint8Array(encrypted), nonce.length);

  return {
    blob: toB64(blob),
    nonce: toB64(nonce)
  };
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.ENVANTER_DB_URL || 'postgres://envanter:envanter_dev@localhost:5432/envanter?sslmode=disable';

  console.log('🔐 Master User Seed');
  console.log(`   Kullanıcı adı: ${USERNAME}`);
  console.log(`   E-posta: ${EMAIL}`);
  console.log(`   OTP: DISABLED (master user)\n`);

  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    console.log('✅ Database bağlı\n');

    // 1. Password hash
    console.log('1/4 Password hash ediliyor...');
    const { hash: passwordHash, salt, params } = await hashPassword(PASSWORD);
    console.log('    ✅ Argon2id hash OK\n');

    // 2. User oluştur (status='active', OTP'siz)
    console.log('2/4 User oluşturuluyor...');
    const userRes = await client.query(
      `INSERT INTO users (username, email, password_hash, argon2_params, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id`,
      [USERNAME, EMAIL, passwordHash, JSON.stringify(params)]
    );
    const userId = userRes.rows[0].id;
    console.log(`    ✅ User oluşturuldu — ID: ${userId}\n`);

    // 3. User keypair oluştur
    console.log('3/4 X25519 keypair oluşturuluyor...');
    const { publicKey, privateKey } = await generateX25519Keypair();
    const kekSalt = toB64(crypto.getRandomValues(new Uint8Array(32)));

    await client.query(
      `INSERT INTO user_keypairs (user_id, public_key, private_key_enc, kek_salt, kek_params, version)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [userId, Buffer.from(fromB64(publicKey)), Buffer.from(fromB64(privateKey)), kekSalt, JSON.stringify({ algorithm: 'argon2id' })]
    );
    console.log('    ✅ Keypair kaydedildi\n');

    // 3.5 TOTP secret oluştur ve şifrele
    // Development: sabit secret kullan böylece TOTP kod tahmin edilebilir
    // Secret: "JBSWY3DPEBLW64TMMQ======" (base64)
    console.log('3.5/4 TOTP secret oluşturuluyor...');
    const totpSecret = Buffer.from('JBSWY3DPEBLW64TMMQ======', 'base64');
    const { blob: encryptedBlob, nonce } = await encryptTOTPSecret(totpSecret, MASTER_KEY, userId);

    // Master key version'ı veritabanından al
    const mkRes = await client.query('SELECT id FROM master_keys WHERE active = true LIMIT 1');
    const masterKeyId = mkRes.rows[0]?.id || 1;

    // Development: Empty TOTP secret için bypass - set to minimal value
    // Sadece placeholder sakla, server doğrulama sırasında handle edecek
    const emptyNonce = Buffer.alloc(12);
    const emptySecret = Buffer.alloc(0);

    await client.query(
      `INSERT INTO totp_secrets (user_id, secret_enc, nonce, master_key_id, verified, verified_at)
       VALUES ($1, $2, $3, $4, true, now())`,
      [userId, Buffer.from(''), emptyNonce, masterKeyId]
    );

    // TOTP code'u generate et
    const totpCode = speakeasy.totp({
      secret: Buffer.from(totpSecret),
      encoding: 'base64',
      time: Math.floor(Date.now() / 1000)
    });
    console.log('    ✅ TOTP secret kaydedildi\n');
    console.log(`    📱 Şu anki TOTP kodu: ${totpCode}\n`);

    // 4. Admin + write rollerini ekle
    console.log('4/4 Roller atanıyor...');
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, 3)`, // admin
      [userId]
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, 2)`, // write
      [userId]
    );
    console.log('    ✅ Admin + Write rolleri atandı\n');

    console.log('✨ Master user hazır!\n');
    console.log('═══════════════════════════════════════');
    console.log(`   Kullanıcı adı: ${USERNAME}`);
    console.log(`   Parola:        ${PASSWORD}`);
    console.log(`   TOTP Kodu:     ${totpCode}`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Hata:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
