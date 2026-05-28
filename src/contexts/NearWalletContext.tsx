import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { NearConnector } from '@hot-labs/near-connect';
import { googleSignIn, decodeJwt, loadGoogleGIS, type GoogleUserProfile } from '@/lib/google-auth';
import { registerWalletWithGoogle, checkGoogleWallet, linkWalletToGoogle, unlinkWalletFromGoogle, fetchWalletLabels, setWalletLabel } from '@/lib/api';
import { saveWalletKey, getAllWalletKeys, renameWalletKey } from '@/lib/wallet-keys';

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
  } catch {
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
}

function saveGoogleSession(session: GoogleSession) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify(session));
}

function loadGoogleSession(): GoogleSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GOOGLE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
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
  shouldReopenModal: boolean;
  clearReopenModal: () => void;
  connect: () => void;
  disconnect: () => void;
  switchNetwork: (network: NetworkType) => void;
  signAndSendTransaction: (params: any) => Promise<any>;
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
  unlinkWalletFromGoogle: () => Promise<void>;
  googleAuthLoading: boolean;
  getApiKey: () => string | null;
  getGoogleIdToken: () => Promise<string>;
  syncWalletLabels: () => Promise<import("@/lib/api").WalletLabel[]>;
  setRemoteWalletLabel: (label: string, walletIndex: number) => Promise<void>;
  loginModalOpen: boolean;
  requestLogin: () => void;
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
    const handleSignIn = ({ accounts }: { accounts: Array<{ accountId: string }> }) => {
      if (accounts?.length > 0) {
        const id = accounts[0].accountId;
        setNearAccountId(id);
        localStorage.setItem('outlayer:cachedAccountId', id);
        setLoginModalOpen(false);
      }
    };

    const handleSignOut = () => {
      setNearAccountId(null);
      localStorage.removeItem('outlayer:cachedAccountId');
    };

    connector.on('wallet:signIn', handleSignIn as any);
    connector.on('wallet:signOut', handleSignOut);

    return () => {
      connector.off('wallet:signIn', handleSignIn as any);
      connector.off('wallet:signOut', handleSignOut);
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
  // Disconnect — handles both NEAR and Google
  // -------------------------------------------------------------------------

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const requestLogin = useCallback(() => setLoginModalOpen(true), []);
  const closeLoginModal = useCallback(() => setLoginModalOpen(false), []);

  const disconnect = useCallback(async () => {
    // Clear Google auth
    if (googleApiKey) {
      setGoogleUser(null);
      setGoogleApiKey(null);
      setGoogleAccountId(null);
      clearGoogleSession();
    }

    // Clear NEAR auth
    if (connectorRef.current && nearAccountId) {
      try {
        await connectorRef.current.disconnect();
      } catch {
        // Already disconnected
      }
    }
    setNearAccountId(null);
    localStorage.removeItem('outlayer:cachedAccountId');
  }, [googleApiKey, nearAccountId]);

  // -------------------------------------------------------------------------
  // Google Sign-In — "Sync with Google" (checks + auto-creates if needed)
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

      // Step 2: Check if wallet already exists (action_num=3, read-only)
      const check = await checkGoogleWallet(idToken);

      let apiKey: string;
      let nearAccount: string;

      if (check.exists && check.api_key) {
        // Wallet exists — restore
        apiKey = check.api_key;
        nearAccount = check.near_account_id || '';
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
      });

      // Sync wallet labels (push local → remote) — idToken is ephemeral, use it now
      syncLabels(idToken).catch(() => {});
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
      });
    } finally {
      setGoogleAuthLoading(false);
    }
  }, []);

  const handleUnlinkWalletFromGoogle = useCallback(async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error('Google Client ID not configured');

    setGoogleAuthLoading(true);
    try {
      const { idToken } = await googleSignIn(clientId);
      await unlinkWalletFromGoogle(idToken);

      setGoogleUser(null);
      setGoogleApiKey(null);
      setGoogleAccountId(null);
      setGoogleWalletExists(false);
      clearGoogleSession();
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

  const handleGetGoogleIdToken = useCallback(async (): Promise<string> => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error('Google Client ID not configured');
    await loadGoogleGIS(clientId);
    const { idToken } = await googleSignIn(clientId);
    return idToken;
  }, []);

  const handleSyncWalletLabels = useCallback(async (): Promise<import("@/lib/api").WalletLabel[]> => {
    if (!googleUser) return [];
    try {
      const idToken = await handleGetGoogleIdToken();
      return await fetchWalletLabels(idToken);
    } catch {
      return [];
    }
  }, [googleUser, handleGetGoogleIdToken]);

  const handleSetRemoteWalletLabel = useCallback(async (label: string, walletIndex: number) => {
    if (!googleUser) return;
    const idToken = await handleGetGoogleIdToken();
    await setWalletLabel(idToken, label, walletIndex);
  }, [googleUser, handleGetGoogleIdToken]);

  /** Push local wallet labels to remote WASM storage (call when idToken is fresh) */
  const syncLabels = useCallback(async (idToken: string) => {
    try {
      // 1. Pull remote labels first
      const remote = await fetchWalletLabels(idToken);
      const entries = getAllWalletKeys();
      const pks = Object.keys(entries);

      // Merge: remote labels → localStorage (if no local label)
      for (const lbl of remote) {
        if (lbl.index < pks.length && pks[lbl.index]) {
          const pk = pks[lbl.index];
          if (lbl.label && !entries[pk]?.label) {
            renameWalletKey(pk, lbl.label);
          }
        }
      }

      // Re-read after merge
      const merged = getAllWalletKeys();
      const mergedPks = Object.keys(merged);

      // 2. Push all local labels → remote
      for (let i = 0; i < mergedPks.length; i++) {
        const label = merged[mergedPks[i]]?.label;
        if (label) {
          await setWalletLabel(idToken, label, i);
        }
      }
    } catch { /* best effort */ }
  }, []);

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
      } catch {
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

  const signAndSendTransaction = useCallback(async (params: any) => {
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
        network,
        contractId: config.contractId,
        rpcUrl: config.rpcUrl,
        stablecoin: config.stablecoin,
        shouldReopenModal,
        clearReopenModal,
        connect,
        disconnect,
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
        syncWalletLabels: handleSyncWalletLabels,
        setRemoteWalletLabel: handleSetRemoteWalletLabel,
        loginModalOpen,
        requestLogin,
        closeLoginModal,
      }}
    >
      {children}
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
