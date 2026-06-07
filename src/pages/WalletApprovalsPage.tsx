import { useState, useEffect, useCallback, useRef } from "react";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getCoordinatorApiUrl } from "@/lib/api";
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
  const [hasPolicies, setHasPolicies] = useState(false);
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
    if (!accountId || !contractId) return;
    setLoading(true);
    setError(null);
    try {
      const wallets = await viewMethodRef.current({
        contractId,
        method: "get_wallet_policies_by_owner",
        args: { owner: accountId },
      }).catch(() => []) as Array<{ wallet_pubkey: string }>;

      const pubkeys = wallets.map((w) => w.wallet_pubkey);
      walletPubkeysRef.current = pubkeys;
      setHasPolicies(pubkeys.length > 0);

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
  }, [accountId, contractId, fetchPendingApprovals]);

  useEffect(() => {
    if (isConnected && accountId) loadApprovals();
  }, [isConnected, accountId, loadApprovals]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!hasPolicies || !isConnected) return;
    const id = setInterval(() => {
      fetchPendingApprovals(walletPubkeysRef.current);
    }, 30_000);
    return () => clearInterval(id);
  }, [hasPolicies, isConnected, fetchPendingApprovals]);

  const handleApprove = async (approval: PendingApproval) => {
    if (!isConnected || !signMessage) {
      setError("Connect your NEAR wallet first.");
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

  const formatType = (type: string) =>
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const isExpired = (a: PendingApproval) => new Date(a.expires_at) < new Date();

  // Not connected
  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-20 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-lime-500/15 mb-4">
          <Wallet size={28} className="text-lime-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">Connect NEAR Wallet</h2>
        <p className="text-sm text-zinc-500 mb-6">
          Connect to view and sign pending multisig approvals.
        </p>
        <button
          onClick={requestNearLogin}
          className="px-6 py-2.5 rounded-xl bg-lime-500 text-black text-sm font-medium hover:bg-lime-400 transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={16} className="text-zinc-400" />
        <h2 className="text-sm font-medium text-zinc-200">Pending Approvals</h2>
        {approvals.length > 0 && (
          <span className="text-[10px] text-zinc-500 ml-auto">{approvals.length}</span>
        )}
        <button
          onClick={loadApprovals}
          className="text-zinc-500 hover:text-zinc-300 ml-1"
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} className="animate-spin text-zinc-400" />
        </div>
      ) : !hasPolicies ? (
        <div className="text-center py-16">
          <ShieldCheck size={32} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No wallet policies found</p>
          <p className="text-xs text-zinc-600 mt-1">
            Set up multisig on /wallet/manage first.
          </p>
        </div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 size={32} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No pending approvals</p>
          <p className="text-xs text-zinc-600 mt-1">
            {accountId ? `Connected: ${accountId.slice(0, 16)}...` : ""}
          </p>
        </div>
      ) : (
        approvals.map((a) => {
          const expired = isExpired(a);
          const amount = (a.request_data.amount || a.request_data.amount_in || "") as string;
          const token = (a.request_data.token || a.request_data.token_in || "") as string;
          const recipient = (a.request_data.to || a.request_data.recipient || "") as string;
          const isPending = approvingId === a.id;

          return (
            <div
              key={a.id}
              className={`mb-3 bg-white/[0.04] border rounded-xl p-4 backdrop-blur-sm ${
                expired ? "border-white/[0.04] opacity-50" : "border-white/[0.08]"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{formatType(a.request_type)}</p>
                  {amount && token && (
                    <p className="text-lg font-semibold text-zinc-200 mt-1">
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
                    <span className="text-[10px] text-zinc-500 w-12">To</span>
                    <span className="text-xs font-mono text-zinc-300 truncate">{recipient}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-12">Wallet</span>
                  <span className="text-xs font-mono text-zinc-400 truncate">
                    {a.wallet_pubkey?.slice(0, 20) ?? a.wallet_id.slice(0, 20)}...
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-12">Signs</span>
                  <span className="text-xs text-zinc-400">
                    {a.approved_count} / {a.required_approvals}
                  </span>
                </div>
              </div>

              {!expired && (
                <button
                  onClick={() => handleApprove(a)}
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-lime-500 text-black text-sm font-medium hover:bg-lime-400 disabled:opacity-50 transition-colors"
                >
                  {isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Signing...
                    </>
                  ) : (
                    <>
                      Approve
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
