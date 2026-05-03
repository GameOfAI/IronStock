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
const { Client } = pkg;

// Node 20'de globalThis.crypto yoksa ata
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const USERNAME = process.argv[2] ?? 'master';
const PASSWORD = process.argv[3] ?? 'Master123456!';
const EMAIL = `${USERNAME}@ironstock.local`;

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

  // Argon2id params: memory=19456KB, time=2, parallelism=1
  const hashBuf = await hash(passwordBuf, salt, {
    algorithm: 'argon2id',
    memory: 19456,
    time: 2,
    parallelism: 1,
  });

  return {
    hash: hashBuf,
    salt: salt,
    params: { algorithm: 'argon2id', memory: 19456, time: 2, parallelism: 1 }
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
      [USERNAME, EMAIL, Buffer.from(passwordHash), JSON.stringify(params)]
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
    console.log(`   OTP:           DISABLED`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Hata:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
