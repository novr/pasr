const IV_LENGTH = 12;
const KEY_LENGTH = 32;

const decodeEncryptionKey = async (keyBase64: string): Promise<CryptoKey> => {
  const trimmed = keyBase64.trim();
  if (trimmed.length === 0) {
    throw new Error("encryption_key_missing");
  }
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(trimmed), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("encryption_key_invalid");
  }
  if (raw.length !== KEY_LENGTH) {
    throw new Error("encryption_key_invalid_length");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
};

export const encryptToken = async (plaintext: string, keyBase64: string): Promise<string> => {
  const key = await decodeEncryptionKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
};

export const decryptToken = async (ciphertextBase64: string, keyBase64: string): Promise<string> => {
  const key = await decodeEncryptionKey(keyBase64);
  const combined = Uint8Array.from(atob(ciphertextBase64), (char) => char.charCodeAt(0));
  if (combined.length <= IV_LENGTH) {
    throw new Error("ciphertext_invalid");
  }
  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
};
