import { useState, useEffect, useCallback, useRef } from "react";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getCoordinatorApiUrl } from "@/lib/api";
import { getAllWalletKeys, getWalletKey } from "@/lib/wallet-keys";
import { Loader2, CheckCircle2, ShieldCheck, Wallet, ArrowRight, RefreshCw } from "lucide-react";

interface PendingApproval {
  id: string;
  wallet_id: string;
  wallet_pubkey: string;
  request_type: string;
  request_data: Record<string, unknown>;
  request_hash: string;
  required_approvals: number;
  approved_count: number;
  status: string;
  expires_at: string;
  created_at: string;
}

export default function WalletApprovalsPage() {
  const { accountId, isConnected, network, contractId, viewMethod, signMessage, requestNearLogin } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);
  const viewMethodRef = useRef(viewMethod);
  viewMethodRef.current = viewMethod;

  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const walletPubkeysRef = useRef<string[]>([]);

  const fetchPendingApprovals = useCallback(async (pubkeys: string[]) => {
    const all: PendingApproval[] = [];
    for (const pubkey of pubkeys) {
      try {
        const resp = await fetch(
          `${coordinatorUrl}/wallet/v1/pending_approvals_by_pubkey?near_pubkey=${encodeURIComponent(pubkey)}`
        );
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.pending_approvals) {
          for (const pa of data.pending_approvals) {
            all.push({ ...pa, wallet_pubkey: pubkey });
          }
        }
      } catch {
        // skip
      }
    }
    setApprovals(all);
  }, [coordinatorUrl]);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pubkeySet = new Set<string>();

      // Source 1: on-chain policies (needs NEAR wallet connected)
      if (isConnected && accountId && contractId) {
        try {
          const wallets = await viewMethodRef.current({
            contractId,
            method: "get_wallet_policies_by_owner",
            args: { owner: accountId },
          }).catch(() => []) as Array<{ wallet_pubkey: string }>;
          for (const w of wallets) pubkeySet.add(w.wallet_pubkey);
        } catch {
          // skip
        }
      }

      // Source 2: local wallet keys (coordinator wallets via Google auth)
      const localKeys = getAllWalletKeys();
      for (const pubkey of Object.keys(localKeys)) {
        pubkeySet.add(pubkey);
      }

      const pubkeys = Array.from(pubkeySet);
      walletPubkeysRef.current = pubkeys;

      if (pubkeys.length === 0) {
        setApprovals([]);
        return;
      }
      await fetchPendingApprovals(pubkeys);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isConnected, accountId, contractId, fetchPendingApprovals]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (walletPubkeysRef.current.length === 0) return;
    const id = setInterval(() => {
      fetchPendingApprovals(walletPubkeysRef.current);
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchPendingApprovals]);

  const handleApprove = async (approval: PendingApproval) => {
    if (!isConnected || !signMessage) {
      setError("Connect your NEAR wallet to sign approvals.");
      return;
    }
    setApprovingId(approval.id);
    setError(null);
    setSuccess(null);

    try {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonceBase64 = btoa(String.fromCharCode(...nonceBytes));

      // NEP-413 message: approve:{id}:{request_hash}
      const message = `approve:${approval.id}:${approval.request_hash}`;

      const signed = await signMessage({
        message,
        recipient: contractId,
        nonce: nonceBase64,
      });

      if (!signed) throw new Error("Signature cancelled");

      const resp = await fetch(`${coordinatorUrl}/wallet/v1/approve/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature: signed.signature,
          public_key: signed.publicKey,
          account_id: signed.accountId,
          nonce: nonceBase64,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Approval failed: ${resp.status}`);
      }

      const result = await resp.json();
      if (result.request_id) {
        setSuccess("Threshold met. Transaction executed.");
      } else {
        setSuccess(`Approved (${result.approved}/${result.required}). Waiting for more.`);
      }
      loadApprovals();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async (approval: PendingApproval) => {
    const apiKey = getWalletKey(approval.wallet_pubkey);
    if (!apiKey) {
      setError("No API key found for this wallet. Cannot reject.");
      return;
    }
    setApprovingId(approval.id);
    setError(null);
    setSuccess(null);
    try {
      const resp = await fetch(`${coordinatorUrl}/wallet/v1/reject/${approval.id}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ approver_account: accountId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Reject failed: ${resp.status}`);
      }
      setSuccess("Request rejected.");
      loadApprovals();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingId(null);
    }
  };

  const formatType = (type: string) =>
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const isExpired = (a: PendingApproval) => new Date(a.expires_at) < new Date();

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Pending Approvals</h2>
        {approvals.length > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">{approvals.length}</span>
        )}
        <button
          onClick={loadApprovals}
          className="text-muted-foreground hover:text-foreground ml-1"
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mb-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-3 bg-lime-500/10 border border-lime-500/20 rounded-lg p-3">
          <p className="text-xs text-lime-400">{success}</p>
        </div>
      )}

      {/* Connect wallet prompt for signing (not blocking view) */}
      {!isConnected && approvals.length > 0 && (
        <div className="mb-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center gap-3">
          <Wallet size={14} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400 flex-1">
            Connect NEAR wallet to sign approvals.
          </p>
          <button
            onClick={requestNearLogin}
            className="text-xs text-amber-300 underline shrink-0"
          >
            Connect
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : walletPubkeysRef.current.length === 0 ? (
        <div className="text-center py-16">
          <ShieldCheck size={32} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No wallets found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Create a wallet or add an API key to see approvals.
          </p>
        </div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 size={32} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No pending approvals</p>
          {isConnected && accountId && (
            <p className="text-xs text-muted-foreground/60 mt-1 font-mono">
              {accountId.slice(0, 20)}...
            </p>
          )}
        </div>
      ) : (
        approvals.map((a) => {
          const expired = isExpired(a);
          const amount = (a.request_data.amount || a.request_data.amount_in || "") as string;
          const token = (a.request_data.token || a.request_data.token_in || "") as string;
          const recipient = (a.request_data.to || a.request_data.recipient || "") as string;
          const isPending = approvingId === a.id;
          const canSign = isConnected && !!signMessage;

          return (
            <div
              key={a.id}
              className={`mb-3 bg-card/50 border rounded-xl p-4 ${
                expired ? "border-border/30 opacity-50" : "border-border/50"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{formatType(a.request_type)}</p>
                  {amount && token && (
                    <p className="text-lg font-semibold text-foreground mt-1">
                      {(Number(amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {" "}
                      {token.includes("usdc") || token.includes("172086") ? "USDC" : token.includes("usdt") ? "USDT" : token.includes("near") ? "NEAR" : token.slice(0, 8)}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${
                  expired ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"
                }`}>
                  {expired ? "Expired" : "Pending"}
                </span>
              </div>

              <div className="space-y-1.5 mb-4">
                {recipient && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-12">To</span>
                    <span className="text-xs font-mono text-foreground/70 truncate">{recipient}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-12">Wallet</span>
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {a.wallet_pubkey?.slice(0, 20) ?? a.wallet_id.slice(0, 20)}...
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-12">Signs</span>
                  <span className="text-xs text-muted-foreground">
                    {a.approved_count} / {a.required_approvals}
                  </span>
                </div>
              </div>

              {!expired && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReject(a)}
                    disabled={isPending}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-muted border border-border text-muted-foreground text-sm font-medium hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 disabled:opacity-50 transition-colors"
                  >
                    <Loader2 size={14} className={isPending ? "animate-spin" : "hidden"} />
                    <span className={isPending ? "hidden" : ""}>Reject</span>
                  </button>
                  <button
                    onClick={() => handleApprove(a)}
                    disabled={isPending || !canSign}
                    className="flex-[2] flex items-center justify-center gap-2 py-2.5 rounded-lg bg-lime-500 text-black text-sm font-medium hover:bg-lime-400 disabled:opacity-50 transition-colors"
                  >
                    {isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Signing...
                      </>
                    ) : !canSign ? (
                      "Connect wallet to sign"
                    ) : (
                      <>
                        Approve
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
