export * from '@envanter/shared/crypto';

/**
 * KEK tabanlı DEK wrap/unwrap — PR-13 öncesi MVP placeholder.
 *
 * Gerçek X25519 sealed-box yerine SHA-256(privateKey) türetilen AES-256-GCM
 * anahtarı kullanılır. Sunucu owner_dek_wrapped alanını PR-13'te expose ettiğinde
 * bu fonksiyonlar openDEK (X25519) ile değiştirilecek.
 *
 * Paket düzeni: wrapped = 32B ephemeral placeholder || ciphertext+tag (48B) = 80B
 * Bu sayede openDEK ile aynı giriş formatını paylaşır.
 */

async function deriveWrapKey(
  privateKey: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const bits = await crypto.subtle.digest('SHA-256', privateKey as BufferSource);
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, [usage]);
}

export async function sealDEKWithKEK(
  dek: Uint8Array,
  privateKey: Uint8Array,
): Promise<{ wrapped: Uint8Array; nonce: Uint8Array }> {
  const wrapKey = await deriveWrapKey(privateKey, 'encrypt');
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      wrapKey,
      dek as BufferSource,
    ),
  );
  const ephPub = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = new Uint8Array(ephPub.length + ctWithTag.length);
  wrapped.set(ephPub);
  wrapped.set(ctWithTag, ephPub.length);
  return { wrapped, nonce };
}

export async function openDEKWithKEK(
  wrapped: Uint8Array,
  nonce: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const wrapKey = await deriveWrapKey(privateKey, 'decrypt');
  const ctWithTag = wrapped.subarray(32); // skip 32-byte ephemeral placeholder
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      wrapKey,
      ctWithTag as BufferSource,
    ),
  );
}
