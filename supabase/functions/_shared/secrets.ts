// AES-256-GCM for values stored in app_secrets, via Deno's Web Crypto API —
// the only runtime that ever encrypts or decrypts a secret (see
// reveal-secret/index.ts for how GitHub Actions scripts get a plaintext
// value without a second crypto implementation in Node). Master key: 32
// random bytes, base64, in the CONFIG_ENCRYPTION_KEY Supabase secret — see
// README's "Encrypted secrets" section for how it's generated and set.
//
// Storage format: base64(iv) + "." + base64(ciphertext‖tag). Web Crypto's
// AES-GCM encrypt() output already has the 16-byte auth tag appended to the
// ciphertext, so this is just the IV alongside it.

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function importKey(masterKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64ToBytes(masterKeyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, masterKeyB64: string): Promise<string> {
  const key = await importKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(blob: string, masterKeyB64: string): Promise<string> {
  const [ivB64, ciphertextB64] = blob.split(".");
  const key = await importKey(masterKeyB64);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(ciphertextB64),
  );
  return new TextDecoder().decode(plaintext);
}

// Reads + decrypts one app_secrets row; null if it isn't set (not an error —
// callers fall back to the pre-encryption env var during the transition, see
// e.g. refresh-prices/index.ts).
// deno-lint-ignore no-explicit-any
export async function getDecryptedSecret(supabase: any, key: string, masterKeyB64: string): Promise<string | null> {
  const { data, error } = await supabase.from("app_secrets").select("ciphertext").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return decryptSecret(data.ciphertext, masterKeyB64);
}
