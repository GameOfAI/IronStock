/**
 * Direct user creation via Server API
 * Creates user, sets up keypair, and optionally skips TOTP
 */

import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const SERVER = 'http://localhost:8080';
const USERNAME = process.argv[2] ?? 'testuser';
const PASSWORD = process.argv[3] ?? 'TestPass123!';
const EMAIL = `${USERNAME}@ironstock.local`;

function toB64(buf) {
  return Buffer.from(buf).toString('base64');
}

function fromB64(s) {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

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

async function main() {
  console.log('🔐 Create User via API');
  console.log(`   Username: ${USERNAME}`);
  console.log(`   Password: ${PASSWORD}\n`);

  try {
    // Generate keypair first
    console.log('1/3 X25519 keypair generating...');
    const { publicKey } = await generateX25519Keypair();
    console.log('    ✅ Keypair OK\n');

    // Register user
    console.log('2/3 Registering user...');
    const registerRes = await fetch(`${SERVER}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: USERNAME,
        email: EMAIL,
        master_password: PASSWORD,
        public_key: publicKey,
      }),
    });
    const registerData = await registerRes.json();

    if (!registerRes.ok) {
      throw new Error(`Register failed: ${registerData.message}`);
    }

    console.log('    ✅ User registered\n');

    // Try login without TOTP
    console.log('3/3 Testing login (without TOTP)...');
    const loginRes = await fetch(`${SERVER}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: USERNAME,
        master_password: PASSWORD,
        totp_code: '000000',
      }),
    });
    const loginData = await loginRes.json();

    if (loginRes.ok) {
      console.log('    ✅ Login successful!\n');
      console.log('✨ User ready!\n');
    } else {
      console.log(`    ⚠️  Login needs: ${loginData.message}`);
      console.log('    (User created, but TOTP setup needed)\n');
    }

    console.log('═══════════════════════════════════════');
    console.log(`   Username: ${USERNAME}`);
    console.log(`   Password: ${PASSWORD}`);
    console.log(`   Server:   ${SERVER}`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
