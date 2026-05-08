/**
 * Passkey-protected wallet API key storage.
 *
 * Flow:
 * 1. User saves a wk_ key (plaintext in localStorage as before)
 * 2. Optionally registers a WebAuthn passkey (fingerprint / Face ID)
 * 3. The key is AES-256-GCM encrypted using a key derived from the passkey credential
 * 4. Encrypted blob is stored in IndexedDB; plaintext is removed from localStorage
 * 5. On next visit, biometric auth decrypts the key into memory only
 *
 * If WebAuthn is not available, falls back to localStorage (no change).
 */

const DB_NAME = "outlayer_passkeys";
const DB_VERSION = 1;
const STORE_NAME = "encrypted_keys";

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

interface EncryptedEntry {
  walletPubkey: string;
  ciphertext: ArrayBuffer; // AES-256-GCM encrypted API key
  iv: ArrayBuffer;         // 12-byte nonce
  salt: ArrayBuffer;       // salt for HKDF key derivation
  credentialId: string;    // WebAuthn credential ID (base64url)
  label?: string;
  savedAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "walletPubkey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(entry: EncryptedEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(walletPubkey: string): Promise<EncryptedEntry | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(walletPubkey);
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(walletPubkey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(walletPubkey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll(): Promise<EncryptedEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

// ─── WebAuthn helpers ────────────────────────────────────────────────────────

/** Check if WebAuthn / platform authenticator is available */
export function isPasskeyAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.PublicKeyCredential !== undefined &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      "function"
  );
}

/** Check if passkeys are supported AND the platform has one (fingerprint, Face ID, etc.) */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeyAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** List of pubkeys that have passkey-protected entries in IndexedDB */
export async function getPasskeyProtectedPubkeys(): Promise<string[]> {
  try {
    const entries = await dbGetAll();
    return entries.map((e) => e.walletPubkey);
  } catch {
    return [];
  }
}

// ─── Crypto helpers ──────────────────────────────────────────────────────────

/**
 * Derive an AES-256-GCM key from a WebAuthn assertion.
 * Uses the authenticatorData + clientDataJSON from the assertion as entropy source,
 * combined with HKDF using a random salt.
 */
async function deriveKey(
  authenticatorData: ArrayBuffer,
  clientDataJSON: ArrayBuffer,
  salt: Uint8Array,
): Promise<CryptoKey> {
  // Concatenate assertion-derived entropy
  const raw = new Uint8Array(
    authenticatorData.byteLength + clientDataJSON.byteLength,
  );
  raw.set(new Uint8Array(authenticatorData), 0);
  raw.set(new Uint8Array(clientDataJSON), authenticatorData.byteLength);

  // Import as raw key material for HKDF
  const baseKey = await crypto.subtle.importKey("raw", raw, "HKDF", false, [
    "deriveKey",
  ]);

  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new Uint8Array(0) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ─── Registration ────────────────────────────────────────────────────────────

const RP_ID = window?.location?.hostname || "localhost";

/** Register a new passkey and encrypt the API key */
export async function registerPasskey(
  walletPubkey: string,
  apiKey: string,
  label?: string,
): Promise<void> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "OutLayer Wallet", id: RP_ID },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: walletPubkey,
        displayName: label || walletPubkey,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256 (P-256)
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 60000,
      attestation: "none",
    },
  })) as PublicKeyCredential;

  if (!credential) throw new Error("Passkey creation failed — no credential returned");

  const credentialId = bufToBase64(credential.rawId);

  // For registration, we don't have an assertion yet.
  // We generate a random encryption key, encrypt the API key with it,
  // then re-encrypt that key using the first assertion's derived key.
  //
  // Simpler approach: use a one-time assertion to derive the encryption key.
  // We do an immediate "verification" of the freshly created credential.

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: credential.rawId }],
      userVerification: "required",
      timeout: 60000,
    },
  })) as PublicKeyCredential;

  if (!assertion?.response) throw new Error("Passkey assertion failed");

  const authData = (assertion.response as AuthenticatorAssertionResponse)
    .authenticatorData;
  const clientData = assertion.response.clientDataJSON;

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const aesKey = await deriveKey(authData, clientData, salt);

  // Encrypt the API key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoded,
  );

  await dbPut({
    walletPubkey,
    ciphertext,
    iv,
    salt,
    credentialId,
    label,
    savedAt: new Date().toISOString(),
  });
}

// ─── Unlock / Decrypt ────────────────────────────────────────────────────────

/**
 * Unlock a passkey-protected API key via biometric auth.
 * Returns the plaintext API key, or null if auth fails.
 */
export async function unlockWithPasskey(
  walletPubkey: string,
): Promise<string | null> {
  const entry = await dbGet(walletPubkey);
  if (!entry) return null;

  const credentialIdBuf = base64ToBuf(entry.credentialId);

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [
          { type: "public-key", id: credentialIdBuf },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    if (!assertion?.response) return null;

    const authData = (assertion.response as AuthenticatorAssertionResponse)
      .authenticatorData;
    const clientData = assertion.response.clientDataJSON;

    const aesKey = await deriveKey(
      authData,
      clientData,
      new Uint8Array(entry.salt),
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(entry.iv) },
      aesKey,
      entry.ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    // Auth failed, cancelled, or decryption error
    return null;
  }
}

// ─── Remove ──────────────────────────────────────────────────────────────────

/** Remove a passkey-protected entry from IndexedDB */
export async function removePasskeyEntry(walletPubkey: string): Promise<void> {
  await dbDelete(walletPubkey);
}

/**
 * Re-encrypt an API key with a new passkey (e.g. after key rotation).
 * Removes old entry, creates new one.
 */
export async function reEncryptWithPasskey(
  walletPubkey: string,
  newApiKey: string,
  label?: string,
): Promise<void> {
  await removePasskeyEntry(walletPubkey);
  await registerPasskey(walletPubkey, newApiKey, label);
}
