import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNearWallet } from "@/contexts/NearWalletContext";
import WalletConnectionModal from "@/components/WalletConnectionModal";
import { getCoordinatorApiUrl } from "@/lib/api";
import { actionCreators } from "@near-js/transactions";
import {
  saveWalletKey,
  getAllWalletKeys,
  removeWalletKey,
} from "@/lib/wallet-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

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
  } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);
  const searchParams = new URLSearchParams(useLocation().search);
  const queryClient = useQueryClient();

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // API key wallet (from ?key=wk_... query param)
  const [apiKeyWallet, setApiKeyWallet] = useState<{
    wallet_id: string;
    address: string;
  } | null>(null);

  // Saved API keys from localStorage
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
  const [showKeyInput, setShowKeyInput] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Load saved keys on mount
  useEffect(() => {
    const all = getAllWalletKeys();
    const map: Record<string, string> = {};
    for (const [pk, entry] of Object.entries(all)) {
      map[pk] = entry.apiKey;
    }
    setSavedKeys(map);
  }, []);

  // Also save key from URL param if we know the wallet pubkey
  useEffect(() => {
    const apiKey = searchParams.get("key");
    if (apiKey && apiKeyWallet) {
      const pk = `ed25519:${apiKeyWallet.address}`;
      saveWalletKey(pk, apiKey);
      setSavedKeys((prev) => ({ ...prev, [pk]: apiKey }));
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
    return savedKeys[walletPubkey] || searchParams.get("key") || null;
  };

  const formatTimestamp = (nanos: number) => {
    return new Date(nanos / 1_000_000).toLocaleString();
  };

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-6">
          Manage Wallets
        </h1>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-zinc-500 mb-6">
              Connect your NEAR wallet to manage wallet policies.
            </p>
            <Button onClick={() => setShowWalletModal(true)} size="lg">
              Connect Wallet
            </Button>
          </CardContent>
        </Card>
        <WalletConnectionModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pt-4">
      {error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-400 rounded-r-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-emerald-50 border-l-4 border-emerald-400 rounded-r-lg p-4">
          <p className="text-sm text-emerald-700">{success}</p>
        </div>
      )}

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
                  <p className="mt-1 text-xs text-zinc-500 font-mono break-all">
                    ed25519:{apiKeyWallet.address}
                  </p>
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

      {isSuccess && wallets.length === 0 && !apiKeyWallet ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-zinc-500">
              No wallet policies found for your account.
            </p>
            <p className="text-sm text-zinc-400 mt-2">
              Wallet policies are created when an AI agent registers a wallet with
              your account as controller.
            </p>
          </CardContent>
        </Card>
      ) : (
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
                            : wallet.wallet_pubkey.split(":")[0]}
                        </Badge>
                        {wallet.frozen ? (
                          <Badge variant="default">FROZEN</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500 font-mono break-all">
                        {wallet.wallet_pubkey.split(":").slice(1).join(":") ||
                          wallet.wallet_pubkey}
                      </p>
                      <p className="text-xs text-zinc-400 mt-1">
                        Updated: {formatTimestamp(wallet.updated_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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

                    {/* Local saved key */}
                    {savedKeys[wallet.wallet_pubkey] ? (
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-xs text-zinc-400">Local:</span>
                        <code className="text-xs font-mono bg-zinc-100 px-2 py-0.5 rounded select-all text-zinc-600">
                          {revealedKeys.has(wallet.wallet_pubkey)
                            ? savedKeys[wallet.wallet_pubkey]
                            : savedKeys[wallet.wallet_pubkey].substring(0, 6) +
                              "..." +
                              savedKeys[wallet.wallet_pubkey].slice(-4)}
                        </code>
                        <button
                          onClick={() =>
                            setRevealedKeys((prev) => {
                              const next = new Set(prev);
                              next.has(wallet.wallet_pubkey)
                                ? next.delete(wallet.wallet_pubkey)
                                : next.add(wallet.wallet_pubkey);
                              return next;
                            })
                          }
                          className="text-xs text-zinc-400 hover:text-zinc-600 px-1"
                        >
                          {revealedKeys.has(wallet.wallet_pubkey)
                            ? "hide"
                            : "show"}
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(
                              savedKeys[wallet.wallet_pubkey],
                            );
                            setSuccess("API key copied");
                            setTimeout(() => setSuccess(null), 2000);
                          }}
                          className="text-xs text-zinc-900 hover:underline px-1 font-medium"
                        >
                          copy
                        </button>
                        <button
                          onClick={() => {
                            removeWalletKey(wallet.wallet_pubkey);
                            setSavedKeys((prev) => {
                              const n = { ...prev };
                              delete n[wallet.wallet_pubkey];
                              return n;
                            });
                          }}
                          className="text-xs text-red-500 hover:text-red-700 px-1"
                        >
                          remove
                        </button>
                      </div>
                    ) : showKeyInput === wallet.wallet_pubkey ? (
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="text"
                          value={keyInput}
                          onChange={(e) => setKeyInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && keyInput.trim()) {
                              saveWalletKey(
                                wallet.wallet_pubkey,
                                keyInput.trim(),
                              );
                              setSavedKeys((prev) => ({
                                ...prev,
                                [wallet.wallet_pubkey]: keyInput.trim(),
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
                              saveWalletKey(
                                wallet.wallet_pubkey,
                                keyInput.trim(),
                              );
                              setSavedKeys((prev) => ({
                                ...prev,
                                [wallet.wallet_pubkey]: keyInput.trim(),
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
                          setShowKeyInput(wallet.wallet_pubkey);
                          setKeyInput("");
                        }}
                        className="text-xs text-zinc-900 hover:underline font-medium mb-2"
                      >
                        + Save API key to browser
                      </button>
                    )}

                    <p className="text-xs text-zinc-400 mt-2">
                      Key is stored in this browser only. To add/rotate keys,
                      update <code className="text-zinc-500">authorized_key_hashes</code> in the policy.
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
