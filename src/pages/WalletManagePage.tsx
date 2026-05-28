import { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNearWallet } from "@/contexts/NearWalletContext";
import WalletConnectionModal from "@/components/WalletConnectionModal";
import WalletBalancesSection from "@/components/wallet/WalletBalancesSection";
import CopyableAddress from "@/components/CopyableAddress";
import { getCoordinatorApiUrl, registerWallet } from "@/lib/api";
import { actionCreators } from "@near-js/transactions";
import {
  saveWalletKey,
  getAllWalletKeys,
  removeWalletKey,
} from "@/lib/wallet-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface WalletPolicy {
  wallet_pubkey: string;
  owner: string;
  frozen: boolean;
  updated_at: number;
}

export default function WalletManagePage() {
  const {
    accountId,
    isConnected,
    network,
    contractId,
    viewMethod,
    signAndSendTransaction,
    authMethod,
    googleUser,
    googleApiKey,
    googleWalletExists,
    createGoogleWallet,
    linkWalletToGoogle,
    unlinkWalletFromGoogle,
    googleAuthLoading,
    loginModalOpen,
    requestLogin,
    closeLoginModal,
  } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);
  const searchParams = new URLSearchParams(useLocation().search);
  const queryClient = useQueryClient();

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importKey, setImportKey] = useState("");

  const handleImportKey = async () => {
    const key = importKey.trim();
    if (!key) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch(`${coordinatorUrl}/wallet/v1/address?chain=near`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        setError(`Invalid API key: HTTP ${resp.status}`);
        return;
      }
      const data = await resp.json();
      const pk = `ed25519:${data.address}`;
      saveWalletKey(pk, key, 'imported');
      setSavedEntries(getAllWalletKeys());
      setSuccess('API key saved!');
      setImportModalOpen(false);
      setImportKey("");
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to import key');
    } finally {
      setSubmitting(false);
    }
  };

  // API key wallet (from ?key=wk_... query param)
  const [apiKeyWallet, setApiKeyWallet] = useState<{
    wallet_id: string;
    address: string;
  } | null>(null);

  // Saved API keys from localStorage
  const [savedEntries, setSavedEntries] = useState<Record<string, import("@/lib/wallet-keys").StoredKey>>({});
  const [showKeyInput, setShowKeyInput] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Load saved keys on mount AND whenever connection state changes (Google auth may add new keys)
  useEffect(() => {
    setSavedEntries(getAllWalletKeys());
  }, [isConnected, googleApiKey]);

  // Also save key from URL param if we know the wallet pubkey
  useEffect(() => {
    const apiKey = searchParams.get("key");
    if (apiKey && apiKeyWallet) {
      const pk = `ed25519:${apiKeyWallet.address}`;
      saveWalletKey(pk, apiKey);
      setSavedEntries((prev) => ({ ...prev, [pk]: { ...(prev[pk] || {}), apiKey, savedAt: new Date().toISOString() } }));
    }
  }, [apiKeyWallet, searchParams]);

  // Resolve API key from query param → wallet_id
  useEffect(() => {
    const apiKey = searchParams.get("key");
    if (!apiKey) return;

    (async () => {
      try {
        const resp = await fetch(
          `${coordinatorUrl}/wallet/v1/address?chain=near`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );
        if (!resp.ok) {
          setError(`Invalid API key: HTTP ${resp.status}`);
          return;
        }
        const data = await resp.json();
        setApiKeyWallet({ wallet_id: data.wallet_id, address: data.address });
      } catch (err) {
        setError(`Failed to resolve API key: ${(err as Error).message}`);
      }
    })();
  }, [searchParams, coordinatorUrl]);

  // Load wallet policies owned by this account
  const {
    data: wallets = [],
    isSuccess,
  } = useQuery({
    queryKey: ["wallet-policies", accountId, contractId],
    queryFn: async () => {
      const result = await viewMethod({
        contractId,
        method: "get_wallet_policies_by_owner",
        args: { owner: accountId },
      }).catch(() => []);
      return (result as WalletPolicy[]) || [];
    },
    enabled: !!accountId && !!contractId && isConnected,
    staleTime: 2 * 60_000,
  });

  const handleFreeze = async (walletPubkey: string) => {
    if (!accountId) return;
    setError(null);
    setSubmitting(true);

    try {
      const action = actionCreators.functionCall(
        "freeze_wallet",
        { wallet_pubkey: walletPubkey },
        BigInt("30000000000000"),
        BigInt("0"),
      );

      await signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });

      setSuccess(`Wallet ${walletPubkey.substring(0, 20)}... frozen`);
      queryClient.invalidateQueries({ queryKey: ["wallet-policies"] });
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnfreeze = async (walletPubkey: string) => {
    if (!accountId) return;
    setError(null);
    setSubmitting(true);

    try {
      const action = actionCreators.functionCall(
        "unfreeze_wallet",
        { wallet_pubkey: walletPubkey },
        BigInt("30000000000000"),
        BigInt("0"),
      );

      await signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });

      setSuccess(`Wallet ${walletPubkey.substring(0, 20)}... unfrozen`);
      queryClient.invalidateQueries({ queryKey: ["wallet-policies"] });
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  /** Get the API key for a wallet — from saved keys or URL param */
  const getWalletApiKey = (walletPubkey: string): string | null => {
    return savedEntries[walletPubkey]?.apiKey || searchParams.get("key") || null;
  };

  const formatTimestamp = (nanos: number) => {
    return new Date(nanos / 1_000_000).toLocaleString();
  };

  /** Simple inline API key display: Local: [masked/key] [show/hide] [copy] [remove] */
  const renderApiKeyRow = (pk: string, apiKey: string, isGoogle?: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-400">Local:</span>
      <code className="text-xs font-mono bg-zinc-100 px-2 py-0.5 rounded select-all text-zinc-600">
        {revealedKeys.has(pk)
          ? apiKey
          : apiKey.substring(0, 6) + "..." + apiKey.slice(-4)}
      </code>
      <button
        onClick={() =>
          setRevealedKeys((prev) => {
            const next = new Set(prev);
            next.has(pk) ? next.delete(pk) : next.add(pk);
            return next;
          })
        }
        className="text-xs text-zinc-400 hover:text-zinc-600 px-1"
      >
        {revealedKeys.has(pk) ? "hide" : "show"}
      </button>
      <button
        onClick={() => {
          navigator.clipboard.writeText(apiKey);
          setSuccess("API key copied");
          setTimeout(() => setSuccess(null), 2000);
        }}
        className="text-xs text-zinc-900 hover:underline px-1 font-medium"
      >
        copy
      </button>
      {isGoogle ? (
        <span className="text-xs text-zinc-400 italic">sign in with Google to recover</span>
      ) : null}
      <button
        onClick={() => {
          removeWalletKey(pk);
          setSavedEntries((prev) => {
            const n = { ...prev };
            delete n[pk];
            return n;
          });
        }}
        className="text-xs text-red-500 hover:text-red-400 px-1"
      >
        {isGoogle ? "remove from device" : "remove"}
      </button>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-6">
          Manage Wallets
        </h1>

        {error && (
          <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Saved API key wallets — visible even without NEAR connection */}
        {Object.keys(savedEntries).length > 0 ? (
          Object.keys(savedEntries).map((pubkey) => (
            <Card key={pubkey} className="mb-4 border-2 border-dashed border-zinc-300">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-zinc-900">
                        {savedEntries[pubkey]?.source === "google" ? "Google Wallet" : "Intent Wallet"}
                      </span>
                      <Badge variant="outline">No Policy</Badge>
                    </div>
                    <CopyableAddress
                      address={pubkey.replace(/^ed25519:/, "")}
                      href={`https://near.rocks/account/${pubkey.replace(/^ed25519:/, "")}`}
                      as="a"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/handoff?key=${savedEntries[pubkey]?.apiKey}`}>
                      <Button size="sm">Set Policy</Button>
                    </Link>
                  </div>
                </div>

                {/* API Key management */}
                <div className="mt-3 pt-3 border-t border-zinc-100">
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-zinc-600">API Key</span>
                  </div>
                  {renderApiKeyRow(pubkey, savedEntries[pubkey]?.apiKey || "", savedEntries[pubkey]?.source === "google")}
                </div>

                <WalletBalancesSection apiKey={savedEntries[pubkey]?.apiKey} accountId={pubkey} />
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                  <rect x="2" y="5" width="20" height="14" rx="3" />
                  <path d="M2 10h20" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-zinc-900 mb-1">No wallets yet</h2>
              <p className="text-zinc-500 text-sm mb-6 max-w-xs mx-auto">
                Sign in with Google to create or recover your wallet, or connect a NEAR wallet.
              </p>
              <div className="flex flex-col items-center gap-3">
                <Button onClick={requestLogin} size="lg">
                  Connect NEAR Wallet
                </Button>
                {/* Google user signed in but no wallet yet → show Create */}
                {googleUser && googleWalletExists === false && (
                  <Button
                    onClick={async () => {
                      setSubmitting(true);
                      setError(null);
                      try {
                        await createGoogleWallet();
                        setSuccess("Wallet created!");
                        setSavedEntries(getAllWalletKeys());
                      } catch (e: any) {
                        setError(e?.message || "Failed to create wallet");
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    size="lg"
                    variant="outline"
                    disabled={submitting || googleAuthLoading}
                  >
                    {submitting ? "Creating..." : "Create Wallet"}
                  </Button>
                )}
                {/* Google user already has wallet → disabled */}
                {googleUser && googleWalletExists === true && (
                  <p className="text-xs text-emerald-600 font-medium">
                    ✓ Wallet already linked to your Google account
                  </p>
                )}
                {!googleUser && (
                  <Button
                    onClick={requestLogin}
                    size="lg"
                    variant="outline"
                  >
                    Sign in with Google
                  </Button>
                )}
                <span className="text-xs text-zinc-400">or save an API key below</span>
                <button
                  onClick={() => setImportModalOpen(true)}
                  className="text-sm text-zinc-900 hover:underline font-medium"
                >
                  + Add API Key
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        <WalletConnectionModal
          isOpen={loginModalOpen}
          onClose={closeLoginModal}
        />

      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pt-4">
      {error && (
        <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-emerald-500/10 border-l-4 border-emerald-500 rounded-r-lg p-4">
          <p className="text-sm text-emerald-400">{success}</p>
        </div>
      )}

      {/* Action buttons — always visible when wallets exist */}
      <div className="flex gap-2 mb-4">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            setSubmitting(true);
            setError(null);
            try {
              const res = await registerWallet(network);
              const pk = `ed25519:${res.near_account_id}`;
              saveWalletKey(pk, res.api_key, "registered wallet");
              setSavedEntries((prev) => ({ ...prev, [pk]: { apiKey: res.api_key, savedAt: new Date().toISOString(), source: "manual" as const } }));
              setSuccess("Wallet created! Your API key has been saved.");
            } catch (e: any) {
              setError(e?.response?.data?.error || e?.message || "Failed to create wallet");
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
        >
          {submitting ? "Creating..." : "+ New Wallet"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setImportModalOpen(true)}
        >
          Import API Key
        </Button>
      </div>

      {/* API key wallet (from ?key= param) — new wallet without policy yet */}
      {apiKeyWallet &&
        !wallets.some(
          (w) => w.wallet_pubkey === `ed25519:${apiKeyWallet.address}`,
        ) && (
          <Card className="mb-4 border-2 border-dashed border-zinc-300">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-zinc-900">
                      New Wallet
                    </span>
                    <Badge variant="outline">No Policy</Badge>
                  </div>
                  <CopyableAddress
                    address={apiKeyWallet.address}
                    href={`https://near.rocks/account/${apiKeyWallet.address}`}
                    as="a"
                  />
                  <p className="text-xs text-zinc-400 mt-1">
                    NEAR address: {apiKeyWallet.address}
                  </p>
                </div>
                <Link
                  to={`/handoff?key=${searchParams.get("key")}`}
                >
                  <Button size="sm">
                    Set Policy
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Saved API key wallets that have no on-chain policy (intent-only, etc.) */}
      {Object.keys(savedEntries)
        .filter(
          (pk) =>
            !wallets.some((w) => w.wallet_pubkey === pk) &&
            !(apiKeyWallet && `ed25519:${apiKeyWallet.address}` === pk),
        )
        .map((pubkey) => (
          <Card key={pubkey} className="mb-4 border-2 border-dashed border-zinc-300">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-zinc-900">
                      {savedEntries[pubkey]?.source === "google" ? "Google Wallet" : "Intent Wallet"}
                    </span>
                    <Badge variant="outline">No Policy</Badge>
                  </div>
                  <div>
                    <CopyableAddress
                      address={pubkey.replace(/^ed25519:/, "")}
                      href={`https://near.rocks/account/${pubkey.replace(/^ed25519:/, "")}`}
                      as="a"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link to={`/handoff?key=${savedEntries[pubkey]?.apiKey}`}>
                      <Button size="sm">Set Policy</Button>
                  </Link>
                  {googleUser && savedEntries[pubkey]?.source !== "google" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={googleAuthLoading}
                      onClick={async () => {
                        setSubmitting(true);
                        setError(null);
                        try {
                          const nearAcct = pubkey.replace(/^ed25519:/, '');
                          await linkWalletToGoogle(savedEntries[pubkey]?.apiKey || '', nearAcct);
                          setSuccess('Wallet linked to Google!');
                          setSavedEntries(getAllWalletKeys());
                        } catch (e: any) {
                          setError(e?.message || 'Failed to link wallet');
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                    >
                      {submitting ? 'Linking...' : 'Sync with Google'}
                    </Button>
                  )}
                </div>
              </div>

              {/* API Key management */}
              <div className="mt-3 pt-3 border-t border-zinc-100">
                <div className="mb-2">
                  <span className="text-xs font-semibold text-zinc-600">API Key</span>
                </div>
                {renderApiKeyRow(pubkey, savedEntries[pubkey]?.apiKey || "", savedEntries[pubkey]?.source === "google")}
              </div>

              {/* Balances (NEAR + Intents tokens) */}
              <WalletBalancesSection apiKey={savedEntries[pubkey]?.apiKey} accountId={pubkey} />
            </CardContent>
          </Card>
        ))}

      {isSuccess && wallets.length === 0 && !apiKeyWallet && Object.keys(savedEntries).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                <rect x="2" y="5" width="20" height="14" rx="3" />
                <path d="M2 10h20" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-zinc-900 mb-1">No wallets found</h2>
            <p className="text-zinc-500 text-sm max-w-xs mx-auto">
              No wallets found for this account. Save an API key to view an intent wallet.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* On-chain wallets with policies */}
      {wallets.length > 0 && (
        <div className="space-y-4">
          {wallets.map((wallet) => {
            const walletKey = getWalletApiKey(wallet.wallet_pubkey);
            return (
              <Card
                key={wallet.wallet_pubkey}
                className={wallet.frozen ? "border-zinc-300" : ""}
              >
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {wallet.wallet_pubkey.startsWith("ed25519:")
                            ? "NEAR"
                            : wallet.wallet_pubkey.split(
                                ":"
                              )[0]}
                        </Badge>
                        {wallet.frozen ? (
                          <Badge variant="default">FROZEN</Badge>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Active</span>
                        )}
                      </div>
                      <CopyableAddress
                        address={
                          wallet.wallet_pubkey.split(":").slice(1).join(":") ||
                          wallet.wallet_pubkey
                        }
                        href={`https://near.rocks/account/${(wallet.wallet_pubkey.split(":").slice(1).join(":") || wallet.wallet_pubkey)}`}
                        as="a"
                      />
                      <p className="text-xs text-zinc-400 mt-1">
                        Updated: {formatTimestamp(wallet.updated_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {walletKey && savedEntries[wallet.wallet_pubkey]?.source === "google" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={googleAuthLoading || submitting}
                          onClick={async () => {
                            setSubmitting(true);
                            setError(null);
                            try {
                              await unlinkWalletFromGoogle();
                              setSuccess('Wallet unlinked from Google!');
                              setSavedEntries(getAllWalletKeys());
                            } catch (e: any) {
                              setError(e?.message || 'Failed to unlink wallet');
                            } finally {
                              setSubmitting(false);
                            }
                          }}
                        >
                          {submitting ? 'Unlinking...' : 'Unlink Google'}
                        </Button>
                      )}
                      {googleUser && walletKey && savedEntries[wallet.wallet_pubkey]?.source !== "google" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={googleAuthLoading || submitting}
                          onClick={async () => {
                            setSubmitting(true);
                            setError(null);
                            try {
                              const nearAcct = wallet.wallet_pubkey.replace(/^ed25519:/, '');
                              await linkWalletToGoogle(walletKey!, nearAcct);
                              setSuccess('Wallet linked to Google!');
                              setSavedEntries(getAllWalletKeys());
                            } catch (e: any) {
                              setError(e?.message || 'Failed to link wallet');
                            } finally {
                              setSubmitting(false);
                            }
                          }}
                        >
                          {submitting ? 'Linking...' : 'Sync with Google'}
                        </Button>
                      )}
                      {walletKey ? (
                        <Link
                          to={`/handoff?key=${walletKey}`}
                        >
                          <Button variant="outline" size="sm">
                            Edit Policy
                          </Button>
                        </Link>
                      ) : (
                        <Button variant="outline" size="sm" disabled className="opacity-50 cursor-not-allowed" title="Save an API key first to edit policy">
                          Edit Policy
                        </Button>
                      )}
                      {wallet.frozen ? (
                        <Button
                          onClick={() => handleUnfreeze(wallet.wallet_pubkey)}
                          disabled={submitting}
                          size="sm"
                        >
                          Unfreeze
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleFreeze(wallet.wallet_pubkey)}
                          disabled={submitting}
                          variant="destructive"
                          size="sm"
                        >
                          Freeze
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* API Key (local browser storage) */}
                  <div className="mt-3 pt-3 border-t border-zinc-100">
                    <div className="mb-2">
                      <span className="text-xs font-semibold text-zinc-600">
                        API Key
                      </span>
                    </div>

                    {(() => {
                      const pk = wallet.wallet_pubkey;
                      const localKey = savedEntries[pk]?.apiKey;

                      if (localKey) {
                        return renderApiKeyRow(pk, localKey, savedEntries[pk]?.source === "google");
                      }

                      // No key saved — show inline input
                      return showKeyInput === pk ? (
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && keyInput.trim()) {
                                saveWalletKey(pk, keyInput.trim());
                                setSavedEntries((prev) => ({
                                  ...prev,
                                  [pk]: keyInput.trim(),
                                }));
                                setKeyInput("");
                                setShowKeyInput(null);
                              }
                            }}
                            placeholder="wk_..."
                            className="flex-1 px-2 py-1 border border-zinc-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-zinc-300"
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              if (keyInput.trim()) {
                                saveWalletKey(pk, keyInput.trim());
                                setSavedEntries((prev) => ({
                                  ...prev,
                                  [pk]: keyInput.trim(),
                                }));
                                setKeyInput("");
                                setShowKeyInput(null);
                              }
                            }}
                            className="text-xs text-zinc-900 hover:underline font-medium"
                          >
                            save
                          </button>
                          <button
                            onClick={() => {
                              setShowKeyInput(null);
                              setKeyInput("");
                            }}
                            className="text-xs text-zinc-400 hover:text-zinc-600"
                          >
                            cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setShowKeyInput(pk);
                            setKeyInput("");
                          }}
                          className="text-xs text-zinc-900 hover:underline font-medium mb-2"
                        >
                          + Save API key to browser
                        </button>
                      );
                    })()}

                    <p className="text-xs text-zinc-400 mt-2">
                      Key is stored in this browser only. To add/rotate keys,
                      update <code className="text-zinc-500">authorized_key_hashes</code> in the policy.
                    </p>
                  </div>

                  {/* Balances (NEAR + Intents tokens) */}
                  <WalletBalancesSection apiKey={walletKey} accountId={wallet.wallet_pubkey} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import API Key</DialogTitle>
            <DialogDescription>
              Paste your OutLayer API key to add an existing wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <input
              type="text"
              placeholder="wk_..."
              value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleImportKey(); }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setImportModalOpen(false); setImportKey(""); }}>
                Cancel
              </Button>
              <Button onClick={handleImportKey} disabled={submitting || !importKey.trim()}>
                {submitting ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}