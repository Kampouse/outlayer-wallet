import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNearWallet } from "@/contexts/NearWalletContext";
import type { GoogleUserProfile } from "@/lib/google-auth";
import WalletConnectionModal from "@/components/WalletConnectionModal";
import WalletBalancesSection from "@/components/wallet/WalletBalancesSection";
import CopyableAddress from "@/components/CopyableAddress";
import { getCoordinatorApiUrl, registerWallet, setWalletLabel, WALLET_API_URL } from "@/lib/api";
import type { WalletLabel } from "@/lib/api";
import { actionCreators } from "@near-js/transactions";
import {
  saveWalletKey,
  getAllWalletKeys,
  removeWalletKey,
  renameWalletKey,
} from "@/lib/wallet-keys";
import type { StoredKey } from "@/lib/wallet-keys";
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
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Key,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Trash2,
  Unlink,
} from "lucide-react";

interface WalletPolicy {
  wallet_pubkey: string;
  owner: string;
  frozen: boolean;
  updated_at: number;
}

interface WalletItem {
  id: string;
  pubkey: string;
  address: string;
  label: string;
  apiKey: string | null;
  frozen: boolean;
  isGoogle: boolean;
  hasPolicy: boolean;
  updatedAt: number | null;
  walletIndex?: number;
}

export default function WalletManagePage() {
  const {
    accountId,
    isConnected,
    network,
    contractId,
    viewMethod,
    signAndSendTransaction,
    nearAccountId,
    isNearConnected,
    requestNearLogin,
    disconnect,
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
    syncWalletLabels,
    setRemoteWalletLabel,
    getValidIdToken,
  } = useNearWallet();

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const queryClient = useQueryClient();

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importKey, setImportKey] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  // API key wallet (from ?key= query param)
  const [apiKeyWallet, setApiKeyWallet] = useState<{
    wallet_id: string;
    address: string;
  } | null>(null);

  // Saved API keys from localStorage
  const [savedEntries, setSavedEntries] = useState<Record<string, StoredKey>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSavedEntries(getAllWalletKeys());
  }, []);

  // Auto-sync wallets from remote ONLY if no local wallets exist yet
  useEffect(() => {
    if (googleUser?.sub) {
      // Always sync from server on mount (merge remote wallets into local)
      (async () => {
        try {
          const idToken = await getValidIdToken();
          const resp = await fetch(`${WALLET_API_URL}/api/wallet/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken }),
          });
          const data = await resp.json();
          if (data.wallets && Array.isArray(data.wallets)) {
            for (const w of data.wallets) {
              if (w.near_account_id && w.api_key) {
                const pk = `ed25519:${w.near_account_id}`;
                const local = getAllWalletKeys()[pk];
                saveWalletKey(pk, w.api_key, w.label || local?.label, local?.source || "google", local?.googleEmail || googleUser.email);
              }
            }
            setSavedEntries(getAllWalletKeys());
          }
        } catch { /* best effort */ }
      })();
    }
  }, [googleUser]);

  // Manual sync — pull all wallets from WASM on demand
  const handleSync = async () => {
    if (!googleUser?.sub) return;
    setSyncing(true);
    try {
      const idToken = await getValidIdToken();
      const resp = await fetch(`${WALLET_API_URL}/api/wallet/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      });
      const data = await resp.json();
      if (data.wallets && Array.isArray(data.wallets)) {
        for (const w of data.wallets) {
          if (w.near_account_id && w.api_key) {
            const pk = `ed25519:${w.near_account_id}`;
            const local = getAllWalletKeys()[pk];
            saveWalletKey(pk, w.api_key, w.label || local?.label, local?.source || "google", local?.googleEmail || googleUser.email, w.index);
          }
        }
        setSavedEntries(getAllWalletKeys());
      }
      setSuccess("Wallets synced!");
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      setError("Sync failed");
      setTimeout(() => setError(null), 2000);
    } finally {
      setSyncing(false);
    }
  };

  const coordinatorUrl = getCoordinatorApiUrl(network);

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
  const { data: walletsData, isSuccess } = useQuery({
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
  const wallets = walletsData ?? [];

  // ─── Merge all wallets into unified list ────────────────────────
  const allWallets = useMemo<WalletItem[]>(() => {
    const items: WalletItem[] = [];
    const seen = new Set<string>();

    // On-chain wallets first
    for (const w of wallets) {
      const addr = w.wallet_pubkey.split(":").slice(1).join(":") || w.wallet_pubkey;
      seen.add(w.wallet_pubkey);
      const saved = savedEntries[w.wallet_pubkey];
      items.push({
        id: w.wallet_pubkey,
        pubkey: w.wallet_pubkey,
        address: addr,
        label: saved?.label || (saved?.source === "google" ? "Google Wallet" : null),
        apiKey: saved?.apiKey || searchParams.get("key") || null,
        frozen: w.frozen,
        isGoogle: saved?.source === "google",
        hasPolicy: true,
        updatedAt: w.updated_at,
        walletIndex: saved?.walletIndex,
      });
    }

    // API key wallet from ?key= param
    if (apiKeyWallet && !seen.has(`ed25519:${apiKeyWallet.address}`)) {
      const pk = `ed25519:${apiKeyWallet.address}`;
      seen.add(pk);
      items.push({
        id: pk,
        pubkey: pk,
        address: apiKeyWallet.address,
        label: "New Wallet",
        apiKey: searchParams.get("key"),
        frozen: false,
        isGoogle: false,
        hasPolicy: false,
        updatedAt: null,
      });
    }

    // Saved keys without on-chain policy
    for (const pk of Object.keys(savedEntries)) {
      if (seen.has(pk)) continue;
      seen.add(pk);
      const saved = savedEntries[pk];
      items.push({
        id: pk,
        pubkey: pk,
        address: pk.replace(/^ed25519:/, ""),
        label: saved?.label || (saved?.source === "google" ? "Google Wallet" : null),
        apiKey: saved?.apiKey || null,
        frozen: false,
        isGoogle: saved?.source === "google",
        hasPolicy: false,
        updatedAt: null,
      });
    }

    // Auto-number unlabeled wallets
    let walletNum = 1;
    items.forEach((item) => {
      if (!item.label) item.label = `Wallet ${walletNum}`;
      walletNum++;
    });

    return items;
  }, [wallets, savedEntries, apiKeyWallet, searchParams]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIdx >= allWallets.length) setSelectedIdx(Math.max(0, allWallets.length - 1));
  }, [allWallets.length, selectedIdx]);

  const currentWallet = allWallets[selectedIdx] ?? null;

  // ─── Actions ──────────────────────────────────────────────────────
  const handleFreeze = async (walletPubkey: string) => {
    if (!signAndSendTransaction || !contractId) return;
    setSubmitting(true); setError(null);
    try {
      await signAndSendTransaction({ receiverId: contractId, actions: [actionCreators.freezeWallet(walletPubkey)] });
      setSuccess("Wallet frozen");
      queryClient.invalidateQueries({ queryKey: ["wallet-policies"] });
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) { setError((err as Error).message); }
    finally { setSubmitting(false); }
  };

  const handleUnfreeze = async (walletPubkey: string) => {
    if (!signAndSendTransaction || !contractId) return;
    setSubmitting(true); setError(null);
    try {
      await signAndSendTransaction({ receiverId: contractId, actions: [actionCreators.unfreezeWallet(walletPubkey)] });
      setSuccess("Wallet unfrozen");
      queryClient.invalidateQueries({ queryKey: ["wallet-policies"] });
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) { setError((err as Error).message); }
    finally { setSubmitting(false); }
  };

  const handleImportKey = async () => {
    const key = importKey.trim();
    if (!key) return;
    setSubmitting(true); setError(null);
    try {
      const resp = await fetch(`${coordinatorUrl}/wallet/v1/address?chain=near`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) { setError(`Invalid API key: HTTP ${resp.status}`); return; }
      const data = await resp.json();
      const pk = `ed25519:${data.address}`;
      saveWalletKey(pk, key, "imported");
      setSavedEntries(getAllWalletKeys());
      setSuccess("API key saved!");
      setImportModalOpen(false); setImportKey("");
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to import key"); }
    finally { setSubmitting(false); }
  };

  const handleCreateWallet = async () => {
    setSubmitting(true); setError(null);
    try {
      const res = await registerWallet(network);
      const pk = `ed25519:${res.near_account_id}`;
      saveWalletKey(pk, res.api_key, "registered wallet");
      setSavedEntries((prev) => ({ ...prev, [pk]: { apiKey: res.api_key, savedAt: new Date().toISOString(), source: "manual" as const } }));
      setSuccess("Wallet created!");
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to create wallet");
    } finally { setSubmitting(false); }
  };

  function toggleReveal(pk: string) {
    setRevealedKeys((prev) => { const n = new Set(prev); n.has(pk) ? n.delete(pk) : n.add(pk); return n; });
  }
  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    setSuccess("Copied!"); setTimeout(() => setSuccess(null), 1500);
  }
  function removeKey(pk: string) {
    removeWalletKey(pk);
    setSavedEntries((prev) => { const n = { ...prev }; delete n[pk]; return n; });
  }

  async function renameWallet(pk: string, name: string) {
    // Save locally first (instant feedback)
    renameWalletKey(pk, name);
    setSavedEntries(getAllWalletKeys());

    // Persist to backend if Google-linked
    if (googleUser?.sub) {
      try {
        const idToken = await getValidIdToken();
        const nearAccountId = pk.startsWith('ed25519:') ? pk.slice(8) : pk;
        await setWalletLabel(idToken, name, undefined, nearAccountId);
      } catch (e: unknown) {
        console.warn('Failed to persist label to backend:', e);
      }
    }
  }

  // Sync labels from WASM on mount (Google auth)
  // NOTE: label sync happens in connectWithGoogle (pull + push during login).
  // No sync needed here — avoids extra Google popup.
  useEffect(() => {}, []);

  function ImportDialog() {
    return (
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import API Key</DialogTitle>
            <DialogDescription>Paste your OutLayer API key to add an existing wallet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <input
              type="text" placeholder="wk_..." value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleImportKey(); }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setImportModalOpen(false); setImportKey(""); }}>Cancel</Button>
              <Button onClick={handleImportKey} disabled={submitting || !importKey.trim()}>
                {submitting ? "Importing..." : "Import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Disconnected state ─────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6">
        {error && <Flash kind="error">{error}</Flash>}

        {allWallets.length > 0 ? (
          <SingleWalletView
            wallets={allWallets}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
            revealedKeys={revealedKeys}
            onToggleReveal={toggleReveal}
            onCopyKey={copyKey}
            onRemoveKey={removeKey}
            onRename={renameWallet}
          />
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
                <Button onClick={requestLogin} size="lg" className="w-full max-w-xs">Sign in with Google</Button>
                <Button onClick={requestLogin} size="lg" variant="outline" className="w-full max-w-xs">Connect NEAR Wallet</Button>
                <button onClick={() => setImportModalOpen(true)} className="text-sm text-zinc-500 hover:text-zinc-900 mt-2">
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

  // ─── Connected state ────────────────────────────────────────────
  const isLoadingWallets = !isSuccess && isConnected && accountId;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      {error && <Flash kind="error">{error}</Flash>}
      {success && <Flash kind="success">{success}</Flash>}

      {/* Loading skeleton */}
      {isLoadingWallets && (
        <Card className="mb-4">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                <div className="h-3 w-24 bg-muted rounded animate-pulse" />
              </div>
            </div>
            <div className="space-y-3">
              <div className="h-10 w-full bg-muted rounded-lg animate-pulse" />
              <div className="h-10 w-full bg-muted rounded-lg animate-pulse" />
              <div className="h-10 w-full bg-muted rounded-lg animate-pulse" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action bar — hide during initial load to prevent premature "Create" clicks */}
      {!isLoadingWallets && (
        <div className="flex gap-2 mb-4">
          {googleUser && (
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            </Button>
          )}
          {!isNearConnected && (
            <Button size="sm" variant="outline" onClick={requestNearLogin}>
              <Link2 size={14} /> Connect NEAR
            </Button>
          )}
        </div>
      )}

      {/* Wallet view */}
      {!isLoadingWallets && allWallets.length > 0 ? (
        <SingleWalletView
          key={allWallets[selectedIdx]?.id ?? selectedIdx}
          wallets={allWallets}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
          revealedKeys={revealedKeys}
          onToggleReveal={toggleReveal}
          onCopyKey={copyKey}
          onRemoveKey={removeKey}
          onRename={renameWallet}
          googleUser={googleUser}
          googleAuthLoading={googleAuthLoading}
          submitting={submitting}
          onFreeze={handleFreeze}
          onUnfreeze={handleUnfreeze}
          onLinkGoogle={async (apiKey, nearAcct) => {
            setSubmitting(true); setError(null);
            try { await linkWalletToGoogle(apiKey, nearAcct); setSuccess("Linked to Google!"); setSavedEntries(getAllWalletKeys()); }
            catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to link"); }
            finally { setSubmitting(false); }
          }}
          onUnlinkGoogle={async (walletIndex: number, nearAccountId: string) => {
            setSubmitting(true); setError(null);
            try { await unlinkWalletFromGoogle(walletIndex, nearAccountId); setSuccess("Unlinked from Google"); setSavedEntries(getAllWalletKeys()); }
            catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to unlink"); }
            finally { setSubmitting(false); }
          }}
        />
      ) : (
        isSuccess && (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-5">
                <Key size={28} className="text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold mb-1">No wallets found</h2>
              <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">Create a new wallet or import an existing API key.</p>
              <div className="flex flex-col items-center gap-3">
                <Button onClick={handleCreateWallet} size="lg" className="w-full max-w-xs" disabled={submitting}>
                  {submitting ? "Creating..." : "Create Wallet"}
                </Button>
                <Button onClick={() => setImportModalOpen(true)} size="lg" variant="outline" className="w-full max-w-xs">
                  Import API Key
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      )}

      <ImportDialog />
    </div>
  );
}

// ─── Single Wallet View (carousel-style) ────────────────────────────

function SingleWalletView({
  wallets, selectedIdx, onSelect, revealedKeys, onToggleReveal, onCopyKey, onRemoveKey, onRename,
  googleUser, googleAuthLoading, submitting, onFreeze, onUnfreeze, onLinkGoogle, onUnlinkGoogle,
}: {
  wallets: WalletItem[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  revealedKeys: Set<string>;
  onToggleReveal: (pk: string) => void;
  onCopyKey: (key: string) => void;
  onRemoveKey: (pk: string) => void;
  onRename?: (pk: string, name: string) => void;
  googleUser?: { sub: string; email?: string; name?: string; picture?: string };
  googleAuthLoading?: boolean;
  submitting?: boolean;
  onFreeze?: (pk: string) => void;
  onUnfreeze?: (pk: string) => void;
  onLinkGoogle?: (apiKey: string, nearAcct: string) => void;
  onUnlinkGoogle?: (walletIndex: number, nearAccountId: string) => void;
}) {
  const w = wallets[selectedIdx];
  if (!w) return null;

  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(w.label);

  useEffect(() => { setEditVal(w.label); }, [w.label]);

  const revealed = revealedKeys.has(w.pubkey);
  const showNav = wallets.length > 1;

  return (
    <div>
      {/* Single wallet card */}
      <Card className={w.frozen ? "opacity-60" : ""}>
        <CardContent className="p-5">
          {/* Header: editable name + status */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 min-w-0">
              {editing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (onRename && editVal.trim()) onRename(w.pubkey, editVal.trim());
                        setEditing(false);
                      }
                      if (e.key === "Escape") setEditing(false);
                    }}
                    autoFocus
                    className="text-sm font-semibold bg-transparent border-b border-zinc-300 outline-none flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (onRename && editVal.trim()) onRename(w.pubkey, editVal.trim());
                      setEditing(false);
                    }}
                    className="text-xs text-lime-600 font-medium px-3 py-1.5 rounded-md bg-lime-50 shrink-0 active:bg-lime-100"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setEditing(false)}
                    className="text-xs text-zinc-400 font-medium px-2 py-1.5 shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditVal(w.label); setEditing(true); }}
                  className="text-sm font-semibold text-zinc-900 hover:text-zinc-600 flex items-center gap-1"
                >
                  {w.label}
                  <Pencil size={11} className="text-zinc-400" />
                </button>
              )}
              <div className={`w-2 h-2 rounded-full shrink-0 ${w.frozen ? "bg-zinc-400" : "bg-lime-500"}`} />
              <span className="text-xs text-zinc-500 shrink-0">{w.frozen ? "Frozen" : "Active"}</span>
              {w.isGoogle && <Badge variant="outline" className="text-[10px] shrink-0">Google</Badge>}
              {!w.hasPolicy && <Badge variant="outline" className="text-[10px] shrink-0">No Policy</Badge>}
            </div>
            {w.updatedAt && (
              <span className="text-[10px] text-zinc-400 shrink-0">
                {new Date(w.updatedAt / 1_000_000).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Address */}
          <CopyableAddress
            address={w.address}
            href={`https://near.rocks/account/${w.address}`}
            as="a"
          />

          {/* Balances */}
          <div className="mt-4">
            <WalletBalancesSection apiKey={w.apiKey} accountId={w.pubkey} />
          </div>

          {/* API Key row */}
          {w.apiKey && (
            <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center gap-2">
              <Key size={12} className="text-zinc-400 shrink-0" />
              <code className="text-[11px] font-mono bg-zinc-100 px-2 py-0.5 rounded text-zinc-500 select-all flex-1 min-w-0 truncate">
                {revealed ? w.apiKey : w.apiKey.substring(0, 6) + "..." + w.apiKey.slice(-4)}
              </code>
              <button onClick={() => onToggleReveal(w.pubkey)} className="text-zinc-400 hover:text-zinc-600 p-1 shrink-0">
                {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button onClick={() => onCopyKey(w.apiKey!)} className="text-zinc-400 hover:text-zinc-600 p-1 shrink-0">
                <Copy size={14} />
              </button>
              <button onClick={() => onRemoveKey(w.pubkey)} className="text-zinc-400 hover:text-red-500 p-1 shrink-0">
                <Trash2 size={14} />
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-zinc-100 flex-wrap">
            {w.apiKey ? (
              <Link to={`/handoff?key=${w.apiKey}`}>
                <Button variant="outline" size="sm"><ShieldCheck size={14} /> Policy</Button>
              </Link>
            ) : (
              <Button variant="outline" size="sm" disabled className="opacity-40">
                <ShieldCheck size={14} /> Policy
              </Button>
            )}
            {w.hasPolicy && onFreeze && onUnfreeze && (
              w.frozen ? (
                <Button size="sm" variant="outline" onClick={() => onUnfreeze(w.pubkey)} disabled={submitting}>
                  Unfreeze
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onFreeze(w.pubkey)} disabled={submitting}>
                  <Snowflake size={14} /> Freeze
                </Button>
              )
            )}
            {googleUser && !w.isGoogle && w.apiKey && onLinkGoogle && (
              <Button size="sm" variant="ghost" disabled={googleAuthLoading || submitting}
                onClick={() => onLinkGoogle(w.apiKey!, w.address)}>
                <Link2 size={14} /> Link to Google
              </Button>
            )}
            {w.isGoogle && w.apiKey && onUnlinkGoogle && (
              <Button size="sm" variant="ghost" disabled={googleAuthLoading || submitting} onClick={() => onUnlinkGoogle(w.walletIndex ?? selectedIdx, w.address)}>
                <Unlink size={14} /> Unlink
              </Button>
            )}
            {!w.apiKey && (
              <span className="text-[11px] text-zinc-400">Save an API key to manage this wallet</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Swipe arrows for mobile */}
      {showNav && (
        <div className="flex items-center justify-between mt-2 px-2">
          <button
            onClick={() => onSelect(Math.max(0, selectedIdx - 1))}
            disabled={selectedIdx === 0}
            className="text-zinc-400 hover:text-zinc-600 disabled:opacity-20 p-1"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-xs text-zinc-400">
            {selectedIdx + 1} / {wallets.length}
          </span>
          <button
            onClick={() => onSelect(Math.min(wallets.length - 1, selectedIdx + 1))}
            disabled={selectedIdx === wallets.length - 1}
            className="text-zinc-400 hover:text-zinc-600 disabled:opacity-20 p-1"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Flash message ──────────────────────────────────────────────────

function Flash({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  return (
    <div className={`mb-3 border-l-4 rounded-r-lg p-3 ${kind === "error" ? "bg-red-500/10 border-red-500" : "bg-lime-500/10 border-lime-500"}`}>
      <p className={`text-sm ${kind === "error" ? "text-red-400" : "text-lime-400"}`}>{children}</p>
    </div>
  );
}
