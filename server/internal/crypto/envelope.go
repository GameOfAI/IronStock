package crypto

// GenerateDEK returns a freshly random 32-byte data encryption key.
//
// Used per row in the envelope encryption flow:
//
//	dek, _ := crypto.GenerateDEK()
//	masterCipher, _ := crypto.NewCipher(masterKey)
//	dekCipher, _ := crypto.NewCipher(dek)
//
//	// Encrypt the row's data with the DEK
//	nameAAD := crypto.MakeAAD("items", itemID, "name_enc")
//	nameEnc, _ := dekCipher.Seal(name, nameAAD)
//
//	// Wrap the DEK with the master key
//	dekAAD := crypto.MakeAAD("items", itemID, "dek")
//	wrappedDEK, _ := masterCipher.Seal(dek, dekAAD)
//
//	// Persist (nameEnc, wrappedDEK, master_key_id) to DB
//
// To rotate the master key, only the wrapped_dek values need to be re-wrapped;
// the per-row ciphertexts stay untouched. See ADR-0004 §8.1.
func GenerateDEK() ([]byte, error) {
	return RandomBytes(KeyLength)
}
