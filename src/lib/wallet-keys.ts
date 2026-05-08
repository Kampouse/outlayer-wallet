/**
 * Browser-local wallet API key storage.
 *
 * Keys are stored ONLY in the browser.
 * The server never stores plaintext API keys — only SHA256 hashes.
 * Users should back up their keys independently.
 *
 * Storage modes:
 * 1. **Plaintext** (default) — localStorage, works everywhere
 * 2. **Passkey-protected** — IndexedDB + AES-GCM + WebAuthn biometric unlock
 *    The key is encrypted and stored in IndexedDB. The plaintext is removed
 *    from localStorage. On unlock, the key lives only in React state.
 */

import {
  isPlatformAuthenticatorAvailable,
  getPasskeyProtectedPubkeys,
  unlockWithPasskey,
  registerPasskey,
  removePasskeyEntry,
} from "./passkey-store";

const STORAGE_KEY = "outlayer_wallet_keys";

export interface StoredKey {
  apiKey: string;
  savedAt: string;
  label?: string;
  passkeyProtected?: boolean;
}

type KeyStore = Record<string, StoredKey>; // walletPubkey → StoredKey

function load(): KeyStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
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
) {
  const store = load();
  store[walletPubkey] = { apiKey, savedAt: new Date().toISOString(), label };
  save(store);
}

/**
 * Save an API key with passkey protection.
 * Encrypts the key and stores in IndexedDB. Removes plaintext from localStorage.
 * Falls back to plaintext if WebAuthn is not available.
 */
export async function saveWalletKeyWithPasskey(
  walletPubkey: string,
  apiKey: string,
  label?: string,
): Promise<{ passkeySaved: boolean }> {
  const hasPlatform = await isPlatformAuthenticatorAvailable();
  if (!hasPlatform) {
    // Fallback to plaintext
    saveWalletKey(walletPubkey, apiKey, label);
    return { passkeySaved: false };
  }

  try {
    await registerPasskey(walletPubkey, apiKey, label);
    // Mark as passkey-protected in localStorage (no plaintext key)
    const store = load();
    store[walletPubkey] = {
      apiKey: "", // no plaintext — encrypted in IndexedDB
      savedAt: new Date().toISOString(),
      label,
      passkeyProtected: true,
    };
    save(store);
    return { passkeySaved: true };
  } catch (err) {
    // Passkey registration failed — fall back to plaintext
    console.warn("Passkey registration failed, saving plaintext:", err);
    saveWalletKey(walletPubkey, apiKey, label);
    return { passkeySaved: false };
  }
}

/**
 * Get saved API key for a wallet pubkey.
 * If passkey-protected, returns null (must call unlockWalletKeyWithPasskey instead).
 */
export function getWalletKey(walletPubkey: string): string | null {
  const store = load();
  const entry = store[walletPubkey];
  if (!entry) return null;
  if (entry.passkeyProtected) return null; // must unlock with passkey
  return entry.apiKey || null;
}

/**
 * Unlock a passkey-protected key via biometric auth.
 * Returns the plaintext API key, or null if auth fails/cancelled.
 */
export async function unlockWalletKeyWithPasskey(
  walletPubkey: string,
): Promise<string | null> {
  return unlockWithPasskey(walletPubkey);
}

/** Get all saved wallet keys (passkey-protected ones have empty apiKey) */
export function getAllWalletKeys(): Record<string, StoredKey> {
  return load();
}

/** Check if a wallet pubkey is passkey-protected */
export function isPasskeyProtected(walletPubkey: string): boolean {
  const store = load();
  return store[walletPubkey]?.passkeyProtected === true;
}

/** Remove a saved key (both localStorage and IndexedDB if passkey-protected) */
export async function removeWalletKey(walletPubkey: string) {
  const store = load();
  delete store[walletPubkey];
  save(store);
  // Also remove from IndexedDB if present
  try {
    await removePasskeyEntry(walletPubkey);
  } catch {
    // Ignore if not in IndexedDB
  }
}

/** Find API key by matching any of the given wallet pubkeys */
export function findKeyForWallets(walletPubkeys: string[]): string | null {
  const store = load();
  for (const pk of walletPubkeys) {
    const entry = store[pk];
    if (entry && !entry.passkeyProtected && entry.apiKey) {
      return entry.apiKey;
    }
  }
  return null;
}

/** Get the set of pubkeys that are passkey-protected (from localStorage metadata) */
export function getPasskeyProtectedFromStore(): string[] {
  const store = load();
  return Object.entries(store)
    .filter(([, v]) => v.passkeyProtected)
    .map(([k]) => k);
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
  if (!key.startsWith("wk_")) return 'Key must start with "wk_"';
  if (key.length !== 67)
    return `Key must be 67 characters (wk_ + 64 hex), got ${key.length}`;
  if (!/^wk_[0-9a-f]{64}$/.test(key))
    return "Key must be wk_ followed by 64 lowercase hex characters";
  return null;
}

/** Generate a random wallet API key */
export function generateWalletKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return (
    "wk_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}
