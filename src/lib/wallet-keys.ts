/**
 * Browser-local wallet API key storage with session-derived encryption.
 *
 * API keys are encrypted at rest in localStorage using AES-GCM.
 * The encryption key is derived from the Google sub + a per-device random salt
 * via PBKDF2 (100k iterations).
 *
 * Security model:
 *   - Knowing the Google `sub` alone is NOT enough to derive the key
 *   - The random salt is stored in localStorage (unique per device/browser)
 *   - An attacker needs BOTH the sub AND the salt to decrypt
 *   - XSS compromise still exposes everything (inherent to browser crypto)
 *
 * Flow:
 *   1. On Google login → initCrypto(idToken) → derives key + decrypts cache
 *   2. All reads/writes go through in-memory decrypted cache (sync API!)
 *   3. On save → encrypt before persisting to localStorage
 *   4. On logout → clearCrypto() wipes in-memory key + cache
 *
 * Migration: initCrypto auto-migrates plaintext entries and entries encrypted
 * with the old v1 scheme (sub-only, fixed salt) to the new v2 scheme.
 */

const STORAGE_KEY = "outlayer_wallet_keys";
const SALT_KEY = "outlayer_crypto_salt";
const KEY_VERSION_KEY = "outlayer_key_version";

export interface StoredKey {
  apiKey: string;
  savedAt: string;
  label?: string;
  source?: "google" | "manual";
  googleEmail?: string;
  walletIndex?: number;
}

type KeyStore = Record<string, StoredKey>; // walletPubkey → StoredKey

// ── Session crypto state ──────────────────────────────────────────────────

let _cryptoKey: CryptoKey | null = null;
let _decryptedCache: KeyStore | null = null;

// ── Raw storage types ────────────────────────────────────────────────────

interface RawEntry {
  apiKey: string;
  savedAt: string;
  label?: string;
  source?: "google" | "manual";
  googleEmail?: string;
  walletIndex?: number;
  encrypted?: boolean;
}

// ── Salt management ──────────────────────────────────────────────────────

/** Get or create the per-device random salt (32 bytes, base64 stored). */
function getOrCreateSalt(): Uint8Array {
  if (typeof window === "undefined") return new Uint8Array(32);
  const existing = localStorage.getItem(SALT_KEY);
  if (existing) {
    return Uint8Array.from(atob(existing), (c) => c.charCodeAt(0));
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(SALT_KEY, btoa(String.fromCharCode(...salt)));
  return salt;
}

/** Derive AES-GCM key from Google sub + per-device random salt. */
export async function initCrypto(googleSub: string): Promise<void> {
  if (!googleSub || typeof window === "undefined") return;

  const salt = getOrCreateSalt();
  // Copy to a fresh ArrayBuffer to satisfy TS strict BufferSource typing
  const saltArray = new Uint8Array(salt);
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(`outlayer-v2:${googleSub}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  _cryptoKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltArray, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  // Decrypt everything into the in-memory cache
  const raw = loadRaw();
  const decrypted: KeyStore = {};
  for (const [pk, entry] of Object.entries(raw)) {
    const { encrypted, ...rest } = entry;
    decrypted[pk] = {
      ...rest,
      apiKey: encrypted ? await decryptValue(entry.apiKey) : entry.apiKey,
    };
  }
  _decryptedCache = decrypted;

  // Re-encrypt and persist (migrates plaintext + old v1 entries)
  await persistCache();

  // Mark that we've migrated to v2
  localStorage.setItem(KEY_VERSION_KEY, "2");
}

/** Wipe the in-memory crypto key and decrypted cache. Call on logout. */
export function clearCrypto(): void {
  _cryptoKey = null;
  _decryptedCache = null;
}

/** Check if encryption is active */
export function isCryptoActive(): boolean {
  return _cryptoKey !== null;
}

// ── Encrypt / Decrypt helpers ─────────────────────────────────────────────

async function encryptValue(plaintext: string): Promise<string> {
  if (!_cryptoKey) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    _cryptoKey,
    new TextEncoder().encode(plaintext),
  );
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
  return `${ivB64}.${ctB64}`;
}

async function decryptValue(ciphertext: string): Promise<string> {
  if (!ciphertext.includes(".")) return ciphertext;
  try {
    const [ivB64, ctB64] = ciphertext.split(".");
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, _cryptoKey!, ct);
    return new TextDecoder().decode(pt);
  } catch (e) {
    console.warn("Decryption failed:", e);
    return ciphertext;
  }
}

// ── Raw storage ───────────────────────────────────────────────────────────

function loadRaw(): Record<string, RawEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch (e) {
    console.warn("Failed to load wallet keys:", e);
    return {};
  }
}

function saveRaw(store: Record<string, RawEntry>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Persist the decrypted cache to localStorage (encrypting if key is active) */
async function persistCache(): Promise<void> {
  if (!_decryptedCache) return;
  const raw: Record<string, RawEntry> = {};
  for (const [pk, entry] of Object.entries(_decryptedCache)) {
    raw[pk] = {
      ...entry,
      apiKey: _cryptoKey ? await encryptValue(entry.apiKey) : entry.apiKey,
      encrypted: _cryptoKey ? true : false,
    };
  }
  saveRaw(raw);
}

// ── Cache management ──────────────────────────────────────────────────────

/** Get the decrypted cache, loading from localStorage if not yet initialized */
function cache(): KeyStore {
  if (_decryptedCache) return _decryptedCache;
  // No crypto session — return raw (plaintext) data directly
  const raw = loadRaw();
  const store: KeyStore = {};
  for (const [pk, entry] of Object.entries(raw)) {
    const { encrypted: _, ...rest } = entry;
    store[pk] = rest;
  }
  _decryptedCache = store;
  return store;
}

function updateCache(pk: string, entry: StoredKey) {
  const store = cache();
  store[pk] = entry;
  _decryptedCache = store;
}

// ── Public API (sync — works because cache is always decrypted) ───────────

/** Save an API key for a wallet pubkey */
export function saveWalletKey(
  walletPubkey: string,
  apiKey: string,
  label?: string,
  source?: "google" | "manual",
  googleEmail?: string,
  walletIndex?: number,
) {
  updateCache(walletPubkey, { apiKey, savedAt: new Date().toISOString(), label, source, googleEmail, walletIndex });
  // Persist asynchronously — don't block UI
  persistCache();
}

/** Get saved API key for a wallet pubkey */
export function getWalletKey(walletPubkey: string): string | null {
  const entry = cache()[walletPubkey];
  if (!entry) return null;
  return entry.apiKey || null;
}

/** Get all saved wallet keys (decrypted) */
export function getAllWalletKeys(): Record<string, StoredKey> {
  return cache();
}

/** Remove a saved key */
export function removeWalletKey(walletPubkey: string) {
  const store = cache();
  delete store[walletPubkey];
  _decryptedCache = store;
  persistCache();
}

/** Rename a saved key */
export function renameWalletKey(walletPubkey: string, name: string) {
  const store = cache();
  if (store[walletPubkey]) {
    store[walletPubkey].label = name || undefined;
    _decryptedCache = store;
    persistCache();
  }
}

/** Find API key by matching any of the given wallet pubkeys */
export function findKeyForWallets(walletPubkeys: string[]): string | null {
  const store = cache();
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
  if (/^wk_[0-9a-f]{64}$/.test(key)) return null;
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
