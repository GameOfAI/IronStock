import { describe, expect, it } from 'vitest';
import {
  decryptPrivateKey,
  decryptField,
  encryptField,
  encryptPrivateKey,
  fromBase64,
  generateDEK,
  generateX25519Keypair,
  openDEK,
  randomKEKSalt,
  sealDEK,
  toBase64,
} from './crypto';

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const raw = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const enc = toBase64(raw);
    expect(typeof enc).toBe('string');
    const dec = fromBase64(enc);
    expect(Array.from(dec)).toEqual(Array.from(raw));
  });

  it('handles empty input', () => {
    expect(toBase64(new Uint8Array())).toBe('');
    expect(fromBase64('').length).toBe(0);
  });

  it('matches RFC4648 known vector', () => {
    // "Man" in ASCII -> "TWFu"
    const m = new Uint8Array([0x4d, 0x61, 0x6e]);
    expect(toBase64(m)).toBe('TWFu');
    expect(Array.from(fromBase64('TWFu'))).toEqual([0x4d, 0x61, 0x6e]);
  });
});

describe('randomKEKSalt', () => {
  it('returns 16 random bytes', () => {
    const a = randomKEKSalt();
    const b = randomKEKSalt();
    expect(a.length).toBe(16);
    expect(b.length).toBe(16);
    // Different invocations should differ (negligible collision risk).
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});

// AES-GCM roundtrip uses real WebCrypto. jsdom 25 ships SubtleCrypto by
// default; the test would fail on environments without it.
describe('AES-GCM private key wrap', () => {
  it('encrypt then decrypt round-trips', async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32));
    const priv = crypto.getRandomValues(new Uint8Array(32));
    const blob = await encryptPrivateKey(priv, kek);
    // Header: version + alg + 12B nonce + ciphertext + 16B tag.
    expect(blob.length).toBe(2 + 12 + priv.length + 16);
    expect(blob[0]).toBe(0x01); // version
    expect(blob[1]).toBe(0x01); // alg AES-GCM

    const decoded = await decryptPrivateKey(blob, kek);
    expect(Array.from(decoded)).toEqual(Array.from(priv));
  });

  it('fails on wrong KEK', async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32));
    const wrongKek = crypto.getRandomValues(new Uint8Array(32));
    const priv = crypto.getRandomValues(new Uint8Array(32));
    const blob = await encryptPrivateKey(priv, kek);
    await expect(decryptPrivateKey(blob, wrongKek)).rejects.toThrow();
  });

  it('rejects truncated blob', async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32));
    await expect(decryptPrivateKey(new Uint8Array([0x01, 0x01, 0x02]), kek)).rejects.toThrow(
      /çok kısa/,
    );
  });

  it('rejects bad version byte', async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32));
    const priv = crypto.getRandomValues(new Uint8Array(32));
    const blob = await encryptPrivateKey(priv, kek);
    blob[0] = 0x99; // tamper version
    await expect(decryptPrivateKey(blob, kek)).rejects.toThrow(/blob versiyonu/);
  });

  it('rejects bad algorithm byte', async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32));
    const priv = crypto.getRandomValues(new Uint8Array(32));
    const blob = await encryptPrivateKey(priv, kek);
    blob[1] = 0x99;
    await expect(decryptPrivateKey(blob, kek)).rejects.toThrow(/algoritma/);
  });
});

describe('generateDEK', () => {
  it('returns 32 random bytes', () => {
    const a = generateDEK();
    const b = generateDEK();
    expect(a.length).toBe(32);
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});

describe('encryptField / decryptField', () => {
  it('round-trips a string value', async () => {
    const dek = generateDEK();
    const plaintext = 's3cr3tP@ssword!';
    const { valueEnc, valueNonce } = await encryptField(plaintext, dek);
    expect(valueNonce.length).toBe(12);
    // ciphertext + 16B GCM tag
    expect(valueEnc.length).toBe(new TextEncoder().encode(plaintext).length + 16);
    const decoded = await decryptField(valueEnc, valueNonce, dek);
    expect(decoded).toBe(plaintext);
  });

  it('round-trips empty string', async () => {
    const dek = generateDEK();
    const { valueEnc, valueNonce } = await encryptField('', dek);
    expect(await decryptField(valueEnc, valueNonce, dek)).toBe('');
  });

  it('fails with wrong DEK', async () => {
    const dek = generateDEK();
    const wrongDek = generateDEK();
    const { valueEnc, valueNonce } = await encryptField('hello', dek);
    await expect(decryptField(valueEnc, valueNonce, wrongDek)).rejects.toThrow();
  });
});

describe('sealDEK / openDEK', () => {
  it('round-trips with own keypair', async () => {
    const { publicKey, privateKey } = await generateX25519Keypair();
    const dek = generateDEK();
    const { wrapped, nonce } = await sealDEK(dek, publicKey);
    // 32B ephemeral_pub + 32B DEK + 16B tag = 80B
    expect(wrapped.length).toBe(80);
    expect(nonce.length).toBe(12);
    const recovered = await openDEK(wrapped, nonce, privateKey);
    expect(Array.from(recovered)).toEqual(Array.from(dek));
  });

  it('fails with wrong private key', async () => {
    const { publicKey } = await generateX25519Keypair();
    const { privateKey: wrongPriv } = await generateX25519Keypair();
    const dek = generateDEK();
    const { wrapped, nonce } = await sealDEK(dek, publicKey);
    await expect(openDEK(wrapped, nonce, wrongPriv)).rejects.toThrow();
  });
});
