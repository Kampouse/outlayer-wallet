import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NearConnector, type SignAndSendTransactionParams } from '@hot-labs/near-connect';
import type { FinalExecutionOutcome } from '@near-js/types';
import { googleSignIn, decodeJwt, loadGoogleGIS, type GoogleUserProfile } from '@/lib/google-auth';
import { registerWalletWithGoogle, checkGoogleWallet, linkWalletToGoogle, unlinkWalletFromGoogle, fetchWalletLabels, setWalletLabel, WALLET_API_URL } from '@/lib/api';
import { saveWalletKey, getAllWalletKeys, renameWalletKey, removeWalletKey, initCrypto, clearCrypto } from '@/lib/wallet-keys';
import WalletConnectionModal from '@/components/WalletConnectionModal';

export type NetworkType = 'testnet' | 'mainnet';

interface SignMessageParams {
  message: string;
  recipient: string;
  nonce: string;
}

interface SignedMessage {
  signature: string;
  publicKey: string;
  accountId: string;
}

export interface StablecoinConfig {
  contract: string;
  decimals: number;
  symbol: string;
}

// ---------------------------------------------------------------------------
// Google key storage helpers
// ---------------------------------------------------------------------------

const GOOGLE_KEYS_STORAGE_KEY = 'outlayer:google_keys';
const GOOGLE_SESSION_KEY = 'outlayer:google_session';

interface StoredGoogleKey {
  apiKey: string;
  nearAccountId: string;
  email: string;
  name: string;
  picture: string;
  savedAt: string;
}

type GoogleKeyStore = Record<string, StoredGoogleKey>; // googleSub → StoredGoogleKey

function loadGoogleKeyStore(): GoogleKeyStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(GOOGLE_KEYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('Failed to load session:', e);
    return {};
  }
}

function saveGoogleKeyStore(store: GoogleKeyStore) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GOOGLE_KEYS_STORAGE_KEY, JSON.stringify(store));
}

function getGoogleKeyForSub(sub: string): StoredGoogleKey | null {
  const store = loadGoogleKeyStore();
  return store[sub] || null;
}

function saveGoogleKeyForSub(sub: string, data: StoredGoogleKey) {
  const store = loadGoogleKeyStore();
  store[sub] = data;
  saveGoogleKeyStore(store);
}

interface GoogleSession {
  sub: string;
  email: string;
  name: string;
  picture: string;
  apiKey: string;
  nearAccountId: string;
  idToken?: string; // stored for unlink/re-auth without popup
  savedAt: number; // epoch ms — used for 24-hour session expiry
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function saveGoogleSession(session: Omit<GoogleSession, 'savedAt'>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
}

function loadGoogleSession(): GoogleSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GOOGLE_SESSION_KEY);
    if (!raw) return null;
    const session: GoogleSession = JSON.parse(raw);
    if (!session.savedAt || Date.now() - session.savedAt > SESSION_TTL_MS) {
      clearGoogleSession();
      return null;
    }
    return session;
  } catch (e) {
    console.warn('Failed to load session:', e);
    return null;
  }
}

function clearGoogleSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(GOOGLE_SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

interface NearWalletContextType {
  accountId: string | null;
  isConnected: boolean;
  isWalletReady: boolean;
  network: NetworkType;
  contractId: string;
  rpcUrl: string;
  stablecoin: StablecoinConfig;
  nearAccountId: string | null;
  isNearConnected: boolean;
  shouldReopenModal: boolean;
  clearReopenModal: () => void;
  connect: () => void;
  disconnect: () => void;
  disconnectNear: () => Promise<void>;
  switchNetwork: (network: NetworkType) => void;
  signAndSendTransaction: (params: SignAndSendTransactionParams) => Promise<FinalExecutionOutcome>;
  signMessage: (params: SignMessageParams) => Promise<SignedMessage | null>;
  viewMethod: (params: { contractId: string; method: string; args?: Record<string, unknown> }) => Promise<unknown>;
  // Google auth
  authMethod: 'near' | 'google' | null;
  googleUser: GoogleUserProfile | null;
  googleApiKey: string | null;
  googleWalletExists: boolean | null; // null = not checked yet
  connectWithGoogle: () => Promise<void>;
  createGoogleWallet: () => Promise<void>;
  linkWalletToGoogle: (apiKey: string, nearAccountId: string) => Promise<void>;
  unlinkWalletFromGoogle: (walletIndex: number, nearAccountId: string) => Promise<void>;
  googleAuthLoading: boolean;
  getApiKey: () => string | null;
  getGoogleIdToken: () => Promise<string>;
  getValidIdToken: () => Promise<string>;
  syncWalletLabels: () => Promise<import("@/lib/api").WalletLabel[]>;
  switchToWallet: (nearAccountId: string, apiKey: string) => void;
  setRemoteWalletLabel: (label: string, walletIndex: number) => Promise<void>;
  loginModalOpen: boolean;
  requestLogin: () => void;
  requestNearLogin: () => void;
  closeLoginModal: () => void;
}

const NearWalletContext = createContext<NearWalletContextType | undefined>(undefined);

const getNetworkConfig = (network: NetworkType) => ({
  contractId: network === 'testnet'
    ? import.meta.env.VITE_TESTNET_CONTRACT_ID || 'outlayer.testnet'
    : import.meta.env.VITE_MAINNET_CONTRACT_ID || 'outlayer.near',
  rpcUrl: network === 'testnet'
    ? import.meta.env.VITE_TESTNET_RPC_URL || 'https://rpc.testnet.near.org'
    : import.meta.env.VITE_MAINNET_RPC_URL || 'https://rpc.mainnet.near.org',
  stablecoin: {
    contract: network === 'testnet'
      ? import.meta.env.VITE_TESTNET_STABLECOIN_CONTRACT || 'usdc.fakes.testnet'
      : import.meta.env.VITE_MAINNET_STABLECOIN_CONTRACT || '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    decimals: network === 'testnet'
      ? parseInt(import.meta.env.VITE_TESTNET_STABLECOIN_DECIMALS || '6', 10)
      : parseInt(import.meta.env.VITE_MAINNET_STABLECOIN_DECIMALS || '6', 10),
    symbol: network === 'testnet'
      ? import.meta.env.VITE_TESTNET_STABLECOIN_SYMBOL || 'USDC'
      : import.meta.env.VITE_MAINNET_STABLECOIN_SYMBOL || 'USDC',
  },
});

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Read network from localStorage or use default
  const getInitialNetwork = (): NetworkType => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('near-wallet-selector:selectedNetworkId');
      if (stored === 'testnet' || stored === 'mainnet') {
        return stored;
      }
    }
    return (import.meta.env.VITE_DEFAULT_NETWORK || 'mainnet') as NetworkType;
  };

  const [network, setNetwork] = useState<NetworkType>(getInitialNetwork);

  // NEAR wallet state — read cached accountId synchronously from localStorage
  const [nearAccountId, setNearAccountId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('outlayer:cachedAccountId');
  });

  // Google auth state — restore session from localStorage on mount
  const [googleUser, setGoogleUser] = useState<GoogleUserProfile | null>(null);
  const [googleApiKey, setGoogleApiKey] = useState<string | null>(null);
  const [googleAccountId, setGoogleAccountId] = useState<string | null>(null);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [googleWalletExists, setGoogleWalletExists] = useState<boolean | null>(null);
  const [pendingIdToken, setPendingIdToken] = useState<string | null>(null);

  const [isWalletReady, setIsWalletReady] = useState(false);
  const [shouldReopenModal, setShouldReopenModal] = useState(false);

  const connectorRef = useRef<NearConnector | null>(null);
  const config = getNetworkConfig(network);

  // Determine auth method: Google takes priority if active
  const authMethod: 'near' | 'google' | null = googleApiKey
    ? 'google'
    : nearAccountId
      ? 'near'
      : null;

  // Unified accountId — Google users get their nearAccountId from registerWallet
  const accountId = googleApiKey ? googleAccountId : nearAccountId;

  const isConnected = !!accountId;

  // Restore Google session from localStorage on mount
  useEffect(() => {
    const session = loadGoogleSession();
    if (session) {
      setGoogleUser({
        sub: session.sub,
        email: session.email,
        name: session.name,
        picture: session.picture,
      });
      setGoogleApiKey(session.apiKey);
      setGoogleAccountId(session.nearAccountId);
      // Re-init crypto with Google sub to decrypt stored keys
      if (session.sub) {
        initCrypto(session.sub).catch(() => { /* will retry on next login */ });
      }
    }
  }, []);

  // Check if we should reopen modal after page reload
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const reopenFlag = localStorage.getItem('near-wallet-selector:reopenModal');
      if (reopenFlag === 'true') {
        setShouldReopenModal(true);
      }
    }
  }, []);

  const clearReopenModal = () => {
    setShouldReopenModal(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('near-wallet-selector:reopenModal');
    }
  };

  // Initialize connector and restore NEAR session
  useEffect(() => {
    setIsWalletReady(false);

    const connector = new NearConnector({
      network: network,
      autoConnect: true,
    });

    connectorRef.current = connector;

    // Try to restore existing session
    connector.getConnectedWallet()
      .then(({ accounts }) => {
        if (accounts?.length > 0) {
          const id = accounts[0].accountId;
          setNearAccountId(id);
          localStorage.setItem('outlayer:cachedAccountId', id);
        } else {
          setNearAccountId(null);
          localStorage.removeItem('outlayer:cachedAccountId');
        }
      })
      .catch(() => {
        // No existing session — clear cache
        setNearAccountId(null);
        localStorage.removeItem('outlayer:cachedAccountId');
      })
      .finally(() => {
        setIsWalletReady(true);
      });

    // Listen for sign-in events
    type SignInEvent = { accounts: Array<{ accountId: string }> };
    const handleSignIn = (payload: SignInEvent) => {
      if (payload.accounts?.length > 0) {
        const id = payload.accounts[0].accountId;
        setNearAccountId(id);
        localStorage.setItem('outlayer:cachedAccountId', id);
        setLoginModalOpen(false);
      }
    };

    const handleSignOut = () => {
      setNearAccountId(null);
      localStorage.removeItem('outlayer:cachedAccountId');
    };

    // connector.on() is generic: on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void)
    // EventMap is not publicly exported. Cast through Parameters<typeof connector.on> to satisfy the signature
    // without resorting to bare `any`.
    type OnCallback = Parameters<typeof connector.on>[1];
    connector.on('wallet:signIn', handleSignIn as OnCallback);
    connector.on('wallet:signOut', handleSignOut as OnCallback);

    return () => {
      connector.off('wallet:signIn', handleSignIn as OnCallback);
      connector.off('wallet:signOut', handleSignOut as OnCallback);
    };
  }, [network]);

  // -------------------------------------------------------------------------
  // NEAR wallet connect (unchanged)
  // -------------------------------------------------------------------------

  const connect = useCallback(() => {
    if (!connectorRef.current) return;
    connectorRef.current.connect().catch(() => {
      // User rejected or wallet error — no action needed
    });
  }, []);

  // -------------------------------------------------------------------------
  // Switch wallet — change active Google-linked wallet
  // -------------------------------------------------------------------------

  const handleSwitchToWallet = useCallback((nearAccountId: string, apiKey: string) => {
    // Clear all wallet-related cached data to prevent stale flash
    queryClient.removeQueries({ queryKey: ['wallet-balance-near'] });
    queryClient.removeQueries({ queryKey: ['wallet-intents-balances'] });
    queryClient.removeQueries({ queryKey: ['base-chain-rhea-balances'] });
    queryClient.removeQueries({ queryKey: ['wallet-policies'] });

    setGoogleAccountId(nearAccountId);
    setGoogleApiKey(apiKey);
    const session = loadGoogleSession();
    if (session) {
      saveGoogleSession({ ...session, apiKey, nearAccountId });
    }
  }, [queryClient]);

  // -------------------------------------------------------------------------
  // Disconnect — handles both NEAR and Google
  // -------------------------------------------------------------------------

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const requestLogin = useCallback(() => {
    if (isConnected) return; // already connected — skip modal
    setLoginModalOpen(true);
  }, [isConnected]);
  const requestNearLogin = useCallback(() => {
    setLoginModalOpen(true);
  }, []);
  const closeLoginModal = useCallback(() => setLoginModalOpen(false), []);

  const disconnect = useCallback(async () => {
    // Clear Google auth + crypto session
    if (googleApiKey) {
      setGoogleUser(null);
      setGoogleApiKey(null);
      setGoogleAccountId(null);
      clearGoogleSession();
      clearCrypto();
    }

    // Clear NEAR auth
    if (connectorRef.current && nearAccountId) {
      try {
        await connectorRef.current.disconnect();
      } catch (e) {
        console.warn('Disconnect error:', e);
        // Already disconnected
      }
    }
    setNearAccountId(null);
    localStorage.removeItem('outlayer:cachedAccountId');
  }, [googleApiKey, nearAccountId]);

  // Disconnect NEAR wallet only — keep Google session intact
  const disconnectNear = useCallback(async () => {
    if (connectorRef.current) {
      try {
        await connectorRef.current.disconnect();
      } catch (e) {
        console.warn('NEAR disconnect error:', e);
      }
    }
    setNearAccountId(null);
    localStorage.removeItem('outlayer:cachedAccountId');
  }, []);

  // -----------------------------------------------------------------------
  // Google Sign-In
  // -------------------------------------------------------------------------

  const connectWithGoogle = useCallback(async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('Google Client ID not configured');
    }

    setGoogleAuthLoading(true);

    try {
      // Step 1: Authenticate with Google
      const { profile, idToken } = await googleSignIn(clientId);

      // Step 1b: Initialize encryption — derive AES key from Google sub
      await initCrypto(profile.sub);

      // Step 2: Check if wallet already exists (action_num=3, read-only)
      const check = await checkGoogleWallet(idToken);

      let apiKey: string;
      let nearAccount: string;

      if (check.exists && check.api_key) {
        // Wallet exists — restore primary wallet
        apiKey = check.api_key;
        nearAccount = check.near_account_id || '';

        // Always fetch wallet list from server and merge with local (remote source of truth)
        const localKeys = getAllWalletKeys();
        try {
          const listResp = await fetch(`${WALLET_API_URL}/api/wallet/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken }),
          });
          const listData = await listResp.json();
          if (listData.wallets && Array.isArray(listData.wallets)) {
            for (const w of listData.wallets) {
              if (w.near_account_id && w.api_key) {
                const pk = `ed25519:${w.near_account_id}`;
                const existing = localKeys[pk];
                // Save remote wallet: always update label/index, keep local key if remote is blank
                const key = w.api_key || existing?.apiKey || '';
                if (key) {
                  saveWalletKey(pk, key, w.label || undefined, "google", profile.email, w.index);
                }
              }
            }
            const primary = listData.wallets.find((w: { index: number }) => w.index === 0);
            if (primary) {
              apiKey = primary.api_key || apiKey;
              nearAccount = primary.near_account_id || nearAccount;
            }
          }
        } catch (e) { /* best effort — primary wallet still works */ console.warn('Failed to fetch wallet list:', e); }
      } else {
        // No wallet — auto-create
        const result = await registerWalletWithGoogle(idToken);
        apiKey = result.api_key;
        nearAccount = result.near_account_id || '';
      }

      // Save everything
      saveGoogleKeyForSub(profile.sub, {
        apiKey,
        nearAccountId: nearAccount,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        savedAt: new Date().toISOString(),
      });

      const pk = `ed25519:${nearAccount}`;
      saveWalletKey(pk, apiKey, `Google: ${profile.email}`, "google", profile.email);

      setGoogleUser(profile);
      setGoogleApiKey(apiKey);
      setGoogleAccountId(nearAccount);
      setGoogleWalletExists(true);
      setPendingIdToken(null);

      saveGoogleSession({
        sub: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        apiKey,
        nearAccountId: nearAccount,
        idToken,
      });
      // Only sync labels from WASM if no local google wallets exist
      const localKeys = getAllWalletKeys();
      const localGoogleWallets = Object.entries(localKeys).filter(([_, e]) => e.source === 'google');
      if (localGoogleWallets.length === 0) {
        syncLabels().catch(() => {});
      }
    } finally {
      setGoogleAuthLoading(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Create Google Wallet (only called when user clicks "Create Wallet")
  // -------------------------------------------------------------------------

  const createGoogleWallet = useCallback(async () => {
    if (!pendingIdToken || !googleUser) {
      throw new Error('Sign in with Google first');
    }

    setGoogleAuthLoading(true);

    try {
      const result = await registerWalletWithGoogle(pendingIdToken);
      const apiKey = result.api_key;
      const nearAccount = result.near_account_id || '';

      saveGoogleKeyForSub(googleUser.sub, {
        apiKey,
        nearAccountId: nearAccount,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        savedAt: new Date().toISOString(),
      });

      const pk = `ed25519:${nearAccount}`;
      saveWalletKey(pk, apiKey, `Google: ${googleUser.email}`, "google", googleUser.email);

      setGoogleApiKey(apiKey);
      setGoogleAccountId(nearAccount);
      setGoogleWalletExists(true);
      setPendingIdToken(null);

      saveGoogleSession({
        sub: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        apiKey,
        nearAccountId: nearAccount,
        idToken: pendingIdToken,
      });
    } finally {
      setGoogleAuthLoading(false);
    }
  }, [pendingIdToken, googleUser]);

  // -------------------------------------------------------------------------
  // Link existing wallet to Google account
  // -------------------------------------------------------------------------

  const handleLinkWalletToGoogle = useCallback(async (apiKey: string, nearAccountId: string) => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error('Google Client ID not configured');

    setGoogleAuthLoading(true);
    try {
      const { profile, idToken } = await googleSignIn(clientId);
      await initCrypto(profile.sub);
      await linkWalletToGoogle(idToken, apiKey, nearAccountId);

      // Save Google session with the linked wallet
      saveGoogleKeyForSub(profile.sub, {
        apiKey,
        nearAccountId,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        savedAt: new Date().toISOString(),
      });

      const pk = `ed25519:${nearAccountId}`;
      saveWalletKey(pk, apiKey, `Google: ${profile.email}`, "google", profile.email);

      setGoogleUser(profile);
      setGoogleApiKey(apiKey);
      setGoogleAccountId(nearAccountId);
      setGoogleWalletExists(true);

      saveGoogleSession({
        sub: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        apiKey,
        nearAccountId,
        idToken,
      });
    } finally {
      setGoogleAuthLoading(false);
    }
  }, []);

  const handleUnlinkWalletFromGoogle = useCallback(async (walletIndex: number, nearAccountId: string) => {
    setGoogleAuthLoading(true);
    try {
      // 1. Remove the wallet from localStorage (match by walletIndex, or by position fallback)
      const keys = getAllWalletKeys();
      const googleEntries = Object.entries(keys).filter(([_, e]) => e.source === 'google');
      // Try by walletIndex first
      let removed = false;
      for (const [pk, entry] of googleEntries) {
        if (entry.walletIndex === walletIndex) {
          removeWalletKey(pk);
          removed = true;
          break;
        }
      }
      // Fallback: match by position in google entries list
      if (!removed && googleEntries[walletIndex]) {
        removeWalletKey(googleEntries[walletIndex][0]);
      }

      // 2. Backend unlink (requires id_token for auth)
      const session = loadGoogleSession();
      let idToken = session?.idToken;

      if (!idToken) {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) throw new Error('Google Client ID not configured');
        const result = await googleSignIn(clientId);
        idToken = result.idToken;
      }

      if (!idToken) throw new Error('Failed to get Google authentication');

      const result = await unlinkWalletFromGoogle(idToken, walletIndex, nearAccountId);
      if (result.status === 'error') {
        throw new Error(result.message || 'Unlink failed');
      }
    } finally {
      setGoogleAuthLoading(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // getApiKey — returns the current API key regardless of auth method
  // -------------------------------------------------------------------------

  const getApiKey = useCallback((): string | null => {
    // Google auth users have a direct API key
    if (googleApiKey) return googleApiKey;

    // For NEAR wallet users, we need to find their key from wallet-keys store
    // This requires knowing the wallet's public key — callers should handle this
    return null;
  }, [googleApiKey]);

  // -------------------------------------------------------------------------
  // Google label sync — get idToken, fetch/save labels via WASM
  // -------------------------------------------------------------------------

  /** Get a valid Google idToken — uses cached session token if fresh, otherwise prompts */
  const getValidIdToken = useCallback(async (): Promise<string> => {
    const session = loadGoogleSession();
    if (session?.idToken) {
      // idTokens last ~1hr; check if we got it within the last 50 min (safety margin)
      const age = Date.now() - (session.savedAt || 0);
      if (age < 50 * 60 * 1000) return session.idToken;
    }
    // Fallback: prompt user
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error('Google Client ID not configured');
    await loadGoogleGIS(clientId);
    const { idToken } = await googleSignIn(clientId);
    // Update session with fresh token
    if (session) {
      saveGoogleSession({ ...session, idToken });
    }
    return idToken;
  }, []);

  const handleGetGoogleIdToken = useCallback(async (): Promise<string> => {
    return getValidIdToken();
  }, [getValidIdToken]);

  const handleSyncWalletLabels = useCallback(async (): Promise<import("@/lib/api").WalletLabel[]> => {
    if (!googleUser?.sub) return [];
    try {
      const idToken = await getValidIdToken();
      return await fetchWalletLabels(idToken);
    } catch (e) {
      console.warn('Failed to sync wallet labels:', e);
      return [];
    }
  }, [googleUser, getValidIdToken]);

  const handleSetRemoteWalletLabel = useCallback(async (label: string, walletIndex: number) => {
    if (!googleUser?.sub) return;
    try {
      const idToken = await getValidIdToken();
      await setWalletLabel(idToken, label, walletIndex);
    } catch (e) { /* non-blocking */ console.warn('Failed to set remote label:', e); }
  }, [googleUser, getValidIdToken]);

  /** Sync all wallets and labels from remote → local using /api/wallet/list (WASM action 8) */
  const syncLabels = useCallback(async () => {
    if (!googleUser?.sub) return;
    try {
      const idToken = await getValidIdToken();
      // 1. Fetch ALL wallets from remote (action 8 returns index, api_key, near_account_id, label)
      const listResp = await fetch(`${WALLET_API_URL}/api/wallet/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      });
      const listData = await listResp.json();

      if (listData.wallets && Array.isArray(listData.wallets)) {
        for (const w of listData.wallets) {
          if (w.near_account_id && w.api_key) {
            const pk = `ed25519:${w.near_account_id}`;
            const existing = getAllWalletKeys()[pk];
            saveWalletKey(pk, w.api_key, w.label || existing?.label, existing?.source || "google", existing?.googleEmail || googleUser.email, w.index);
          }
        }
      }

      // 2. Also pull labels from dedicated endpoint as fallback
      const remote = await fetchWalletLabels(idToken);
      const entries = getAllWalletKeys();

      // Build a map of near_account_id → pk from localStorage for matching
      const acctToPk: Record<string, string> = {};
      for (const pk of Object.keys(entries)) {
        const addr = pk.replace(/^ed25519:/, '');
        acctToPk[addr] = pk;
      }

      // Merge: remote labels → localStorage (by WASM index → pubkey via near_account_id from list)
      if (listData.wallets) {
        const walletByIndex: Record<number, string> = {};
        for (const w of listData.wallets) {
          walletByIndex[w.index] = w.near_account_id;
        }
        for (const lbl of remote) {
          const acct = walletByIndex[lbl.index];
          if (acct) {
            const pk = acctToPk[acct] || `ed25519:${acct}`;
            if (lbl.label && !entries[pk]?.label) {
              renameWalletKey(pk, lbl.label);
            }
          }
        }
      }

      // 3. Push all local labels → remote (match by near_account_id to find WASM index)
      const merged = getAllWalletKeys();
      if (listData.wallets) {
        const acctToIndex: Record<string, number> = {};
        for (const w of listData.wallets) {
          acctToIndex[w.near_account_id] = w.index;
        }
        for (const pk of Object.keys(merged)) {
          const addr = pk.replace(/^ed25519:/, '');
          const idx = acctToIndex[addr];
          const label = merged[pk]?.label;
          if (idx !== undefined && label) {
            await setWalletLabel(idToken, label, idx);
          }
        }
      }
    } catch (e) { /* best effort */ console.warn('Failed to sync labels:', e); }
  }, [googleUser]);

  // -------------------------------------------------------------------------
  // Network switching
  // -------------------------------------------------------------------------

  const switchNetwork = useCallback(async (newNetwork: NetworkType) => {
    // Store selected network in localStorage
    localStorage.setItem('near-wallet-selector:selectedNetworkId', newNetwork);
    // Set flag to reopen modal after reload
    localStorage.setItem('near-wallet-selector:reopenModal', 'true');

    // Disconnect current wallet before switching
    if (connectorRef.current && nearAccountId) {
      try {
        await connectorRef.current.disconnect();
      } catch (e) {
        console.warn('Disconnect error:', e);
        // Already disconnected
      }
      setNearAccountId(null);
    }

    // Set new network — useEffect will reinitialize connector
    setNetwork(newNetwork);
  }, [nearAccountId]);

  // -------------------------------------------------------------------------
  // Transaction helpers (NEAR wallet only)
  // -------------------------------------------------------------------------

  const signAndSendTransaction = useCallback(async (params: SignAndSendTransactionParams): Promise<FinalExecutionOutcome> => {
    const connector = connectorRef.current;
    if (!connector) throw new Error('Wallet not initialized');
    const wallet = await connector.wallet();
    return await wallet.signAndSendTransaction(params);
  }, []);

  const signMessage = useCallback(async (params: SignMessageParams): Promise<SignedMessage | null> => {
    const connector = connectorRef.current;
    if (!connector || !nearAccountId) throw new Error('Wallet not connected');

    try {
      const wallet = await connector.wallet();

      const result = await wallet.signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce: Buffer.from(params.nonce, 'base64'),
        network: network,
        signerId: nearAccountId,
      });

      return {
        signature: result.signature,
        publicKey: result.publicKey,
        accountId: result.accountId,
      };
    } catch (error) {
      console.error('Error signing message:', error);
      throw error;
    }
  }, [nearAccountId, network]);

  const viewMethod = useCallback(async (params: { contractId: string; method: string; args?: Record<string, unknown> }) => {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: params.contractId,
          method_name: params.method,
          args_base64: btoa(JSON.stringify(params.args || {})),
        },
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'View method call failed');
    }

    const resultBytes = data.result?.result;
    if (!resultBytes || resultBytes.length === 0) {
      return null;
    }

    const resultStr = new TextDecoder().decode(new Uint8Array(resultBytes));
    return JSON.parse(resultStr);
  }, [config.rpcUrl]);

  return (
    <NearWalletContext.Provider
      value={{
        accountId,
        isConnected,
        isWalletReady,
        nearAccountId,
        isNearConnected: !!nearAccountId,
        network,
        contractId: config.contractId,
        rpcUrl: config.rpcUrl,
        stablecoin: config.stablecoin,
        shouldReopenModal,
        clearReopenModal,
        connect,
        disconnect,
        disconnectNear,
        switchNetwork,
        signAndSendTransaction,
        signMessage,
        viewMethod,
        // Google auth
        authMethod,
        googleUser,
        googleApiKey,
        googleWalletExists,
        connectWithGoogle,
        createGoogleWallet,
        linkWalletToGoogle: handleLinkWalletToGoogle,
        unlinkWalletFromGoogle: handleUnlinkWalletFromGoogle,
        googleAuthLoading,
        getApiKey,
        getGoogleIdToken: handleGetGoogleIdToken,
        getValidIdToken,
        syncWalletLabels: handleSyncWalletLabels,
        switchToWallet: handleSwitchToWallet,
        setRemoteWalletLabel: handleSetRemoteWalletLabel,
        loginModalOpen,
        requestLogin,
        requestNearLogin,
        closeLoginModal,
      }}
    >
      {children}
      <WalletConnectionModal isOpen={loginModalOpen} onClose={closeLoginModal} />
    </NearWalletContext.Provider>
  );
}

export function useNearWallet() {
  const context = useContext(NearWalletContext);
  if (context === undefined) {
    throw new Error('useNearWallet must be used within a NearWalletProvider');
  }
  return context;
}
