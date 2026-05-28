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
import {
  ArrowDownToLine,
  Copy,
  Eye,
  EyeOff,
  Key,
  Link2,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Snowflake,
  Trash2,
  Unlink,
  X,
} from "lucide-react";

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

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
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
      const coordinatorUrl = getCoordinatorApiUrl(network);
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

  // API key wallet (from ?key= query param)
  const [apiKeyWallet, setApiKeyWallet] = useState<{
    wallet_id: string;
    address: string;
  } | null>(null);

  // Saved API keys from localStorage
  const [savedEntries, setSavedEntries] = useState<Record<string, import("@/lib/wallet-keys").StoredKey>>({});
  const [showKeyInput, setShowKeyInput] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Load saved keys on mount AND whenever connection state changes
  useEffect(() => {
    setSavedEntries(getAllWalletKeys());
  }, [isConnected, accountId, authMethod, googleUser, googleApiKey]);

  const coordinatorUrl = getCoordinatorApiUrl(network);

  // Load API key wallet from ?key= param
  useEffect(() => {
    const keyParam = searchParams.get("key");
    if (keyParam?.startsWith("wk_")) {
      fetch(`${coordinatorUrl}/wallet/v1/address?chain=near`, {
        headers: { Authorization: `Bearer ${keyParam}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.address) {
            setApiKeyWallet({ wallet_id: data.wallet_id, address: data.address });
            saveWalletKey(`ed25519:${data.address}`, keyParam!, "handoff");
            setSavedEntries(getAllWalletKeys());
          }
        })
        .catch(() => {});
    }
  }, [searchParams, coordinatorUrl]);

  // Fetch on-chain wallet policies
  const { data: wallets = [], isSuccess } = useQuery({
    queryKey: ["wallet-policies", accountId, isConnected],
    queryFn: async () => {
      if (!isConnected || !viewMethod) return [];
      try {
        const result = await viewMethod({
          contractId: contractId!,
          method: "get_wallets",
          args: { owner: accountId! },
        });
        return result as WalletPolicy[];
      } catch {
        return [];
      }
    },
    enabled: isConnected && !!accountId && !!viewMethod,
  });

  const handleFreeze = async (walletPubkey: string) => {
    if (!signAndSendTransaction || !contractId) return;
    setSubmitting(true);
    setError(null);
    try {
      const action = actionCreators.freezeWallet(walletPubkey);
      await signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });
      setSuccess("Wallet frozen");
      queryClient.invalidateQueries({ queryKey: ["wallet-policies"] });
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnfreeze = async (walletPubkey: string) => {
    if (!signAndSendTransaction || !contractId) return;
    setSubmitting(true);
    setError(null);
    try {
      const action = actionCreators.unfreezeWallet(walletPubkey);
      await signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });
      setSuccess(`Wallet unfrozen`);
      queryClient.invalidateQueries({ queryKey: ["wallet-policies"] });
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const getWalletApiKey = (walletPubkey: string): string | null => {
    return savedEntries[walletPubkey]?.apiKey || searchParams.get("key") || null;
  };

  const formatTimestamp = (nanos: number) => {
    return new Date(nanos / 1_000_000).toLocaleString();
  };

  function toggleReveal(pk: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      next.has(pk) ? next.delete(pk) : next.add(pk);
      return next;
    });
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    setSuccess("Copied!");
    setTimeout(() => setSuccess(null), 1500);
  }

  function removeKey(pk: string) {
    removeWalletKey(pk);
    setSavedEntries((prev) => {
      const n = { ...prev };
      delete n[pk];
      return n;
    });
  }

  function ImportDialog() {
    return (
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
    );
  }

  // ─── Disconnected state (no NEAR, no Google) ─────────────────────
  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6">
        {error && (
          <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {Object.keys(savedEntries).length > 0 ? (
          <div className="space-y-3">
            {Object.keys(savedEntries).map((pubkey) => (
              <WalletCard
                key={pubkey}
                pubkey={pubkey}
                apiKey={savedEntries[pubkey]?.apiKey || ""}
                isGoogle={savedEntries[pubkey]?.source === "google"}
                revealed={revealedKeys.has(pubkey)}
                onToggleReveal={() => toggleReveal(pubkey)}
                onCopyKey={() => copyKey(savedEntries[pubkey]?.apiKey || "")}
                onRemoveKey={() => removeKey(pubkey)}
              />
            ))}
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={requestLogin} className="flex-1">
                Connect NEAR
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportModalOpen(true)} className="flex-1">
                <Plus size={14} /> Import
              </Button>
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-5">
                <Key size={28} className="text-zinc-400" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-900 mb-1">No wallets yet</h2>
              <p className="text-zinc-500 text-sm mb-8 max-w-xs mx-auto">
                Sign in with Google or connect a NEAR wallet to get started.
              </p>
              <div className="flex flex-col items-center gap-3">
                <Button onClick={requestLogin} size="lg" className="w-full max-w-xs">
                  Sign in with Google
                </Button>
                <Button onClick={requestLogin} size="lg" variant="outline" className="w-full max-w-xs">
                  Connect NEAR Wallet
                </Button>
                <button
                  onClick={() => setImportModalOpen(true)}
                  className="text-sm text-zinc-500 hover:text-zinc-900 mt-2"
                >
                  or import an API key
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        <WalletConnectionModal isOpen={loginModalOpen} onClose={closeLoginModal} />
        <ImportDialog />
      </div>
    );
  }

  // ─── Connected state ──────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      {/* Flash messages */}
      {error && (
        <div className="mb-3 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-3 bg-emerald-500/10 border-l-4 border-emerald-500 rounded-r-lg p-3">
          <p className="text-sm text-emerald-400">{success}</p>
        </div>
      )}

      {/* Action bar */}
      <div className="flex gap-2 mb-4">
        {googleUser && googleWalletExists === false && (
          <Button
            size="sm"
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
            disabled={submitting || googleAuthLoading}
            className="flex-1"
          >
            {submitting ? "Creating..." : "Create Wallet"}
          </Button>
        )}
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
              setSuccess("Wallet created!");
            } catch (e: any) {
              setError(e?.response?.data?.error || e?.message || "Failed to create wallet");
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
          className="flex-1"
        >
          <Plus size={14} /> New Wallet
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setImportModalOpen(true)}
        >
          <ArrowDownToLine size={14} />
        </Button>
      </div>

      {/* API key wallet from ?key= param */}
      {apiKeyWallet &&
        !wallets.some((w) => w.wallet_pubkey === `ed25519:${apiKeyWallet.address}`) && (
          <Card className="mb-3 border-dashed border-2 border-zinc-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">New Wallet</span>
                    <Badge variant="outline" className="text-[10px]">No Policy</Badge>
                  </div>
                  <CopyableAddress
                    address={apiKeyWallet.address}
                    href={`https://near.rocks/account/${apiKeyWallet.address}`}
                    as="a"
                  />
                </div>
                <Link to={`/handoff?key=${searchParams.get("key")}`}>
                  <Button size="sm">Set Policy</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

      {/* On-chain wallets */}
      {wallets.length > 0 && (
        <div className="space-y-3">
          {wallets.map((wallet) => {
            const walletKey = getWalletApiKey(wallet.wallet_pubkey);
            const addr = wallet.wallet_pubkey.split(":").slice(1).join(":") || wallet.wallet_pubkey;
            const isGoogleWallet = savedEntries[wallet.wallet_pubkey]?.source === "google";
            return (
              <Card key={wallet.wallet_pubkey} className={wallet.frozen ? "opacity-60" : ""}>
                <CardContent className="p-4">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${wallet.frozen ? "bg-zinc-400" : "bg-emerald-500"}`} />
                      <span className="text-xs text-zinc-500">
                        {wallet.frozen ? "Frozen" : "Active"}
                      </span>
                      {isGoogleWallet && (
                        <Badge variant="outline" className="text-[10px]">Google</Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-400">
                      Updated {formatTimestamp(wallet.updated_at)}
                    </span>
                  </div>

                  {/* Address */}
                  <CopyableAddress
                    address={addr}
                    href={`https://near.rocks/account/${addr}`}
                    as="a"
                  />

                  {/* Balances */}
                  <WalletBalancesSection apiKey={walletKey} accountId={wallet.wallet_pubkey} />

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-100">
                    {walletKey ? (
                      <Link to={`/handoff?key=${walletKey}`}>
                        <Button variant="outline" size="sm">
                          <ShieldCheck size={14} /> Policy
                        </Button>
                      </Link>
                    ) : (
                      <Button variant="outline" size="sm" disabled className="opacity-40">
                        <ShieldCheck size={14} /> Policy
                      </Button>
                    )}
                    {wallet.frozen ? (
                      <Button size="sm" variant="outline" onClick={() => handleUnfreeze(wallet.wallet_pubkey)} disabled={submitting}>
                        Unfreeze
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => handleFreeze(wallet.wallet_pubkey)} disabled={submitting}>
                        <Snowflake size={14} />
                      </Button>
                    )}
                    {googleUser && !isGoogleWallet && walletKey && (
                      <Button size="sm" variant="ghost" disabled={googleAuthLoading || submitting}
                        onClick={async () => {
                          setSubmitting(true);
                          setError(null);
                          try {
                            const nearAcct = wallet.wallet_pubkey.replace(/^ed25519:/, '');
                            await linkWalletToGoogle(walletKey!, nearAcct);
                            setSuccess('Linked to Google!');
                            setSavedEntries(getAllWalletKeys());
                          } catch (e: any) {
                            setError(e?.message || 'Failed to link');
                          } finally { setSubmitting(false); }
                        }}>
                        <Link2 size={14} />
                      </Button>
                    )}
                    {isGoogleWallet && walletKey && (
                      <Button size="sm" variant="ghost" disabled={googleAuthLoading || submitting}
                        onClick={async () => {
                          setSubmitting(true);
                          setError(null);
                          try {
                            await unlinkWalletFromGoogle();
                            setSuccess('Unlinked from Google');
                            setSavedEntries(getAllWalletKeys());
                          } catch (e: any) {
                            setError(e?.message || 'Failed to unlink');
                          } finally { setSubmitting(false); }
                        }}>
                        <Unlink size={14} />
                      </Button>
                    )}
                    {/* API key management */}
                    {walletKey && (
                      <ApiKeyDisplay
                        pubkey={wallet.wallet_pubkey}
                        apiKey={walletKey}
                        isGoogle={isGoogleWallet}
                        revealed={revealedKeys.has(wallet.wallet_pubkey)}
                        onToggleReveal={() => toggleReveal(wallet.wallet_pubkey)}
                        onCopy={() => copyKey(walletKey!)}
                        onRemove={() => removeKey(wallet.wallet_pubkey)}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Saved keys without on-chain policy */}
      {Object.keys(savedEntries)
        .filter((pk) =>
          !wallets.some((w) => w.wallet_pubkey === pk) &&
          !(apiKeyWallet && `ed25519:${apiKeyWallet.address}` === pk)
        )
        .map((pubkey) => (
          <Card key={pubkey} className="mb-3 border-dashed border-2 border-zinc-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {savedEntries[pubkey]?.source === "google" ? "Google Wallet" : "Wallet"}
                  </span>
                  <Badge variant="outline" className="text-[10px]">No Policy</Badge>
                </div>
                <Link to={`/handoff?key=${savedEntries[pubkey]?.apiKey}`}>
                  <Button size="sm" variant="outline">Set Policy</Button>
                </Link>
              </div>
              <CopyableAddress
                address={pubkey.replace(/^ed25519:/, "")}
                href={`https://near.rocks/account/${pubkey.replace(/^ed25519:/, "")}`}
                as="a"
              />
              <WalletBalancesSection apiKey={savedEntries[pubkey]?.apiKey} accountId={pubkey} />
              <div className="mt-3 pt-3 border-t border-zinc-100">
                <ApiKeyDisplay
                  pubkey={pubkey}
                  apiKey={savedEntries[pubkey]?.apiKey || ""}
                  isGoogle={savedEntries[pubkey]?.source === "google"}
                  revealed={revealedKeys.has(pubkey)}
                  onToggleReveal={() => toggleReveal(pubkey)}
                  onCopy={() => copyKey(savedEntries[pubkey]?.apiKey || "")}
                  onRemove={() => removeKey(pubkey)}
                />
              </div>
              {googleUser && savedEntries[pubkey]?.source !== "google" && (
                <div className="mt-2">
                  <Button size="sm" variant="outline" disabled={googleAuthLoading || submitting}
                    onClick={async () => {
                      setSubmitting(true);
                      setError(null);
                      try {
                        const nearAcct = pubkey.replace(/^ed25519:/, '');
                        await linkWalletToGoogle(savedEntries[pubkey]?.apiKey || '', nearAcct);
                        setSuccess('Linked to Google!');
                        setSavedEntries(getAllWalletKeys());
                      } catch (e: any) {
                        setError(e?.message || 'Failed to link');
                      } finally { setSubmitting(false); }
                    }}>
                    <Link2 size={14} /> Sync with Google
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

      {/* Empty state when connected but no wallets */}
      {isSuccess && wallets.length === 0 && !apiKeyWallet && Object.keys(savedEntries).length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-5">
              <Key size={28} className="text-zinc-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 mb-1">No wallets found</h2>
            <p className="text-zinc-500 text-sm mb-6 max-w-xs mx-auto">
              Create a new wallet or import an existing API key.
            </p>
            <div className="flex flex-col items-center gap-3">
              <Button onClick={async () => {
                setSubmitting(true);
                setError(null);
                try {
                  const res = await registerWallet(network);
                  const pk = `ed25519:${res.near_account_id}`;
                  saveWalletKey(pk, res.api_key, "registered wallet");
                  setSavedEntries((prev) => ({ ...prev, [pk]: { apiKey: res.api_key, savedAt: new Date().toISOString(), source: "manual" as const } }));
                  setSuccess("Wallet created!");
                } catch (e: any) {
                  setError(e?.response?.data?.error || e?.message || "Failed");
                } finally { setSubmitting(false); }
              }} size="lg" className="w-full max-w-xs" disabled={submitting}>
                {submitting ? "Creating..." : "Create Wallet"}
              </Button>
              <Button onClick={() => setImportModalOpen(true)} size="lg" variant="outline" className="w-full max-w-xs">
                Import API Key
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ImportDialog />
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function ApiKeyDisplay({
  pubkey, apiKey, isGoogle, revealed, onToggleReveal, onCopy, onRemove,
}: {
  pubkey: string; apiKey: string; isGoogle: boolean; revealed: boolean;
  onToggleReveal: () => void; onCopy: () => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 ml-auto">
      <code className="text-[10px] font-mono bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-500 select-all">
        {revealed ? apiKey : apiKey.substring(0, 6) + "..." + apiKey.slice(-4)}
      </code>
      <button onClick={onToggleReveal} className="text-zinc-400 hover:text-zinc-600 p-0.5">
        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
      <button onClick={onCopy} className="text-zinc-400 hover:text-zinc-600 p-0.5">
        <Copy size={12} />
      </button>
      <button onClick={onRemove} className="text-zinc-400 hover:text-red-500 p-0.5">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function WalletCard({
  pubkey, apiKey, isGoogle, revealed, onToggleReveal, onCopyKey, onRemoveKey,
}: {
  pubkey: string; apiKey: string; isGoogle: boolean; revealed: boolean;
  onToggleReveal: () => void; onCopyKey: () => void; onRemoveKey: () => void;
}) {
  return (
    <Card className="border-dashed border-2 border-zinc-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">
            {isGoogle ? "Google Wallet" : "Wallet"}
          </span>
          <Badge variant="outline" className="text-[10px]">No Policy</Badge>
        </div>
        <CopyableAddress
          address={pubkey.replace(/^ed25519:/, "")}
          href={`https://near.rocks/account/${pubkey.replace(/^ed25519:/, "")}`}
          as="a"
        />
        <WalletBalancesSection apiKey={apiKey} accountId={pubkey} />
        <div className="mt-3 pt-3 border-t border-zinc-100">
          <ApiKeyDisplay
            pubkey={pubkey}
            apiKey={apiKey}
            isGoogle={isGoogle}
            revealed={revealed}
            onToggleReveal={onToggleReveal}
            onCopy={onCopyKey}
            onRemove={onRemoveKey}
          />
        </div>
      </CardContent>
    </Card>
  );
}
