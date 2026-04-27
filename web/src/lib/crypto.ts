/**
 * Client-side crypto primitives for the auth flow.
 *
 * ADR-0009 §3 / ADR-0004 §4-§5 implementation:
 *
 *   master_password
 *     │
 *     ├─ Argon2id(salt=kek_salt, params=kek_params)  ← hash-wasm
 *     │   → KEK (32B)
 *     │
 *     ├─ AES-GCM-decrypt(private_key_enc, KEK)        ← WebCrypto SubtleCrypto
 *     │   → private_key (32B X25519 raw)
 *     │
 *     └─ NEVER leaves this module to long-term storage. authStore holds
 *        the derived material in-memory, cleared on logout.
 *
 * Wire format kuralı: server `[]byte` alanlarını JSON'da base64 string olarak
 * gönderir. Bu modül bunları `Uint8Array`'e decode eder + reverse encoder
 * sağlar (PR-W2 register/recover/change-password formları için).
 */

import { argon2id } from 'hash-wasm';

// --- Base64 helpers ---

/** RFC 4648 base64 → Uint8Array. Atob path'i; native + fast. */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Uint8Array → RFC 4648 base64. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// --- Argon2id KEK derive ---

/**
 * KEK params shape — server'dan dönen `kek_params` jsonb'sinin alanları.
 * Server-side ADR-0004 §4 default: t=3, m=64MiB (65536 KiB), p=4, key=32.
 *
 * `salt_b64` server tarafında jsonb'ye persist'lerken eklendi (PR-5
 * persistArgon2Salt); `kek_salt` field'i ile mükerrer ama biz sadece
 * `kek_salt`'ı kullanıyoruz (canonical source).
 */
export interface KEKParams {
  /** Argon2id time cost (iterations). Default 3. */
  t: number;
  /** Memory cost in KiB. Default 65536 (64 MiB). */
  m: number;
  /** Parallelism. Default 4. */
  p: number;
  /** Argon2 version (0x13 = 19 = Argon2 v1.3). */
  v?: number;
}

/** Argon2id default params (mirror of crypto.DefaultArgon2Params on server). */
export const DEFAULT_KEK_PARAMS: KEKParams = {
  t: 3,
  m: 65536,
  p: 4,
  v: 19,
};

/** Length of derived KEK in bytes. AES-256 → 32. */
export const KEK_LEN = 32;

/**
 * Derive a 32-byte KEK from the user's master password using Argon2id.
 *
 * `salt` and `params` come from the server (`/users/me/keypair` response,
 * or `RegisterRequest`/`RecoverComplete` for the inverse path).
 *
 * Heavy operation: ~200-500ms on a modern CPU. Caller should show a
 * "Deriving key..." spinner during the await.
 */
export async function deriveKEK(
  masterPassword: string,
  salt: Uint8Array,
  params: KEKParams = DEFAULT_KEK_PARAMS,
): Promise<Uint8Array> {
  const out = await argon2id({
    password: masterPassword,
    salt,
    iterations: params.t,
    memorySize: params.m, // KiB
    parallelism: params.p,
    hashLength: KEK_LEN,
    outputType: 'binary',
  });
  return new Uint8Array(out);
}

// --- AES-256-GCM (private_key wrap/unwrap) ---

/**
 * Server-side blob layout (server/internal/crypto/format.go):
 *   [version:1][alg_id:1][nonce:12][ct + tag:N+16]
 *
 * Versioned blob serialization is server's concern; client only needs to
 * peel the header off when *decrypting* private_key_enc, and produce a
 * matching wrapped payload when *encrypting* (e.g. change-password's
 * new_private_key_enc). AAD must match server's MakeAAD pattern:
 *
 *   `${table}:${row_id}:${column}` with NUL byte separator (server uses '\0').
 *
 * For user_keypairs.private_key_enc, server doesn't bind row id (KEK is
 * derived from password, not stored — there's no other row to confuse
 * with), so client AAD is `''` (empty). Confirmed by inspection of
 * server/internal/crypto/argon2.go usage: HashPassword has no AAD; the
 * private_key wrap is per-user implicit.
 */
const HEADER_LEN = 2;
const NONCE_LEN = 12;
const ALG_AES_GCM = 0x01;
const FORMAT_VERSION = 0x01;

/** Decrypt private_key_enc with KEK → raw 32-byte X25519 private key. */
export async function decryptPrivateKey(
  privateKeyEnc: Uint8Array,
  kek: Uint8Array,
): Promise<Uint8Array> {
  if (privateKeyEnc.length < HEADER_LEN + NONCE_LEN + 16) {
    throw new Error('private_key_enc çok kısa (header+nonce+tag eksik)');
  }
  const version = privateKeyEnc[0];
  const alg = privateKeyEnc[1];
  if (version !== FORMAT_VERSION) {
    throw new Error(`Beklenmeyen blob versiyonu: ${version}`);
  }
  if (alg !== ALG_AES_GCM) {
    throw new Error(`Beklenmeyen algoritma: ${alg}`);
  }
  const nonce = privateKeyEnc.subarray(HEADER_LEN, HEADER_LEN + NONCE_LEN);
  const cipherWithTag = privateKeyEnc.subarray(HEADER_LEN + NONCE_LEN);

  // TS 5.7 sıkılaştırdı: Uint8Array<ArrayBufferLike> != BufferSource (SAB
  // ayırımı). Runtime'da hep ArrayBuffer-backed; WebCrypto için cast yeterli.
  const key = await crypto.subtle.importKey('raw', kek as BufferSource, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    key,
    cipherWithTag as BufferSource,
  );
  return new Uint8Array(plaintext);
}

/**
 * Encrypt a plaintext (e.g. private key) with KEK → versioned blob ready
 * to ship as `new_private_key_enc` in change-password / recover-complete
 * payloads.
 */
export async function encryptPrivateKey(
  plaintext: Uint8Array,
  kek: Uint8Array,
): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = await crypto.subtle.importKey('raw', kek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipherWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      plaintext as BufferSource,
    ),
  );
  const out = new Uint8Array(HEADER_LEN + NONCE_LEN + cipherWithTag.length);
  out[0] = FORMAT_VERSION;
  out[1] = ALG_AES_GCM;
  out.set(nonce, HEADER_LEN);
  out.set(cipherWithTag, HEADER_LEN + NONCE_LEN);
  return out;
}

// --- X25519 keypair generation (register / recover) ---

/**
 * Generate a fresh X25519 keypair for register / recover-complete.
 *
 * WebCrypto X25519 is Chrome 113+ / Firefox 130+ / Safari 17+. For
 * older browsers we'd fall back to @noble/curves, deferred to Faz 5
 * — production target is modern evergreen browsers.
 */
export async function generateX25519Keypair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  const kp = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  // Private key export: SubtleCrypto exposes X25519 private as PKCS#8 only.
  // The last 32 bytes of PKCS#8 are the raw scalar (deterministic layout
  // per RFC 8410). This matches server-side `crypto/ecdh.PrivateKey.Bytes()`.
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const privRaw = pkcs8.slice(pkcs8.length - 32);
  return { publicKey: pubRaw, privateKey: privRaw };
}

// --- Random salt (register / change-password) ---

/** Cryptographically random salt for KEK derivation (16B per ADR-0004 §4). */
export function randomKEKSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}
