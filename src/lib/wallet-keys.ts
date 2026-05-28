/**
 * Browser-local wallet API key storage.
 *
 * Keys are stored ONLY in the browser (localStorage).
 * The backend encrypts API keys at rest (AES-GCM, base64-encoded) before
 * returning them to the client. The frontend stores whatever the backend
 * returns — no client-side encryption/decryption is needed. When sending
 * an api_key back to the server (e.g. for link actions), the server
 * handles decryption.
 *
 * Users should back up their keys independently.
 */

const STORAGE_KEY = "outlayer_wallet_keys";

export interface StoredKey {
  apiKey: string;
  savedAt: string;
  label?: string;
  source?: "google" | "manual";
  googleEmail?: string;
}

type KeyStore = Record<string, StoredKey>; // walletPubkey → StoredKey

function load(): KeyStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch {
    return {};
  }
}

function save(store: KeyStore) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Save an API key for a wallet pubkey (e.g. "ed25519:abc...") */
export function saveWalletKey(
  walletPubkey: string,
  apiKey: string,
  label?: string,
  source?: "google" | "manual",
  googleEmail?: string,
) {
  const store = load();
  store[walletPubkey] = { apiKey, savedAt: new Date().toISOString(), label, source, googleEmail };
  save(store);
}

/** Get saved API key for a wallet pubkey */
export function getWalletKey(walletPubkey: string): string | null {
  const store = load();
  const entry = store[walletPubkey];
  if (!entry) return null;
  return entry.apiKey || null;
}

/** Get all saved wallet keys */
export function getAllWalletKeys(): Record<string, StoredKey> {
  return load();
}

/** Remove a saved key */
export function removeWalletKey(walletPubkey: string) {
  const store = load();
  delete store[walletPubkey];
  save(store);
}

/** Rename a saved key */
export function renameWalletKey(walletPubkey: string, name: string) {
  const store = load();
  if (store[walletPubkey]) {
    store[walletPubkey].label = name || undefined;
    save(store);
  }
}

/** Find API key by matching any of the given wallet pubkeys */
export function findKeyForWallets(walletPubkeys: string[]): string | null {
  const store = load();
  for (const pk of walletPubkeys) {
    const entry = store[pk];
    if (entry && entry.apiKey) {
      return entry.apiKey;
    }
  }
  return null;
}

/** Compute SHA256 hex hash of an API key string */
export async function computeKeyHash(key: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Validate wallet API key format. Returns error message or null if valid. */
export function validateWalletKeyFormat(key: string): string | null {
  if (!key || typeof key !== "string") return "Key is required";
  // Accept legacy plaintext keys (wk_ + 64 hex chars)
  if (/^wk_[0-9a-f]{64}$/.test(key)) return null;
  // Accept encrypted keys (base64-encoded blobs from the backend)
  // Base64 characters: A-Z, a-z, 0-9, +, /, optionally padded with =
  if (/^[A-Za-z0-9+/]+=*$/.test(key) && key.length >= 16) return null;
  return "Key must be a valid wk_ hex key or an encrypted (base64) key";
}

/** Generate a random wallet API key */
export function generateWalletKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return (
    "wk_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}
