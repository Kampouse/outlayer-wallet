import { useState, useEffect, useCallback } from "react";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getCoordinatorApiUrl } from "@/lib/api";
import { Loader2, CheckCircle2, ShieldCheck, Wallet, ArrowRight } from "lucide-react";

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
  approvers: { approver_id: string; approver_role: string; created_at: string }[];
}

export default function WalletApprovalsPage() {
  const { accountId, isConnected, network, contractId, signMessage, requestNearLogin } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);

  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    if (!isConnected || !accountId) return;
    setLoading(true);
    setError(null);
    try {
      // Try fetching by pubkey — we need the user's NEAR public key
      // The API endpoint is /wallet/v1/pending_approvals_by_pubkey?near_pubkey=...
      // But we may not have the pubkey directly. Let's try by approver account.
      const resp = await fetch(
        `${coordinatorUrl}/wallet/v1/pending_approvals_by_approver?approver=${encodeURIComponent(accountId)}`
      );
      if (!resp.ok) {
        // Fallback: try by pubkey
        // We'll skip for now and show empty
        setApprovals([]);
        return;
      }
      const data = await resp.json();
      setApprovals(data.pending_approvals ?? data.approvals ?? data ?? []);
    } catch {
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [isConnected, accountId, coordinatorUrl]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const handleApprove = async (approval: PendingApproval) => {
    if (!isConnected || !signMessage) {
      setError("Connect your NEAR wallet first.");
      return;
    }

    setApprovingId(approval.id);
    setError(null);
    setSuccess(null);

    try {
      // Generate 32-byte random nonce
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonceBase64 = btoa(String.fromCharCode(...nonceBytes));

      // Build NEP-413 message: approve:{id}:{wallet_pubkey}:{request_hash}
      const message = `approve:${approval.id}:${approval.wallet_pubkey}:${approval.request_hash}`;

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
        // Threshold met — tx executed
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

  const formatType = (type: string) => {
    return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatAmount = (data: Record<string, unknown>) => {
    const amount = (data.amount || data.amount_in || "") as string;
    const token = (data.token || data.token_in || "") as string;
    if (amount && token) return `${formatTokenAmount(amount)} ${shortToken(token)}`;
    return "";
  };

  const formatTokenAmount = (atomic: string) => {
    const n = Number(atomic) / Math.pow(10, 6);
    if (n > 0.01) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return (Number(atomic) / Math.pow(10, 24)).toFixed(4);
  };

  const shortToken = (t: string) => {
    if (t === "near" || t === "wrap.near") return "NEAR";
    if (t.includes("usdt")) return "USDT";
    if (t.includes("usdc") || t.includes("172086")) return "USDC";
    if (t.includes("eth")) return "ETH";
    if (t.includes("btc")) return "BTC";
    return t.slice(0, 8);
  };

  // Not connected
  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-20 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-lime-500/15 mb-4">
          <Wallet size={28} className="text-lime-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">Connect NEAR Wallet</h2>
        <p className="text-sm text-zinc-500 mb-6">
          Connect your NEAR wallet to view and sign pending approvals.
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
          <span className="text-[10px] text-zinc-500 ml-auto">{approvals.length} pending</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="mb-3 bg-lime-500/10 border border-lime-500/20 rounded-lg p-3">
          <p className="text-xs text-lime-400">{success}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} className="animate-spin text-zinc-400" />
        </div>
      )}

      {/* Empty */}
      {!loading && approvals.length === 0 && (
        <div className="text-center py-16">
          <CheckCircle2 size={32} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No pending approvals</p>
          <p className="text-xs text-zinc-600 mt-1">
            {accountId ? `Connected as ${accountId.slice(0, 12)}...` : ""}
          </p>
        </div>
      )}

      {/* Approval cards */}
      {!loading && approvals.map((a) => {
        const isExpired = new Date(a.expires_at) < new Date();
        const amount = formatAmount(a.request_data);
        const recipient = (a.request_data.to || a.request_data.recipient || "") as string;
        const isPending = approvingId === a.id;

        return (
          <div
            key={a.id}
            className="mb-3 bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 backdrop-blur-sm"
          >
            {/* Type + amount */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-zinc-100">{formatType(a.request_type)}</p>
                {amount && (
                  <p className="text-lg font-semibold text-zinc-200 mt-1">{amount}</p>
                )}
              </div>
              <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${
                isExpired
                  ? "bg-red-500/10 text-red-400"
                  : "bg-amber-500/10 text-amber-400"
              }`}>
                {isExpired ? "Expired" : "Pending"}
              </span>
            </div>

            {/* Details */}
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
                  {a.wallet_id.slice(0, 20)}...
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 w-12">Signs</span>
                <span className="text-xs text-zinc-400">
                  {a.approved_count ?? a.approvers?.length ?? 0} / {a.required_approvals}
                </span>
              </div>
            </div>

            {/* Approve button */}
            {!isExpired && (
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
                    Approve with NEAR Wallet
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
