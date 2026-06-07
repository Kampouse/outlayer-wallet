import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { getCoordinatorApiUrl } from "@/lib/api";
import { getAllWalletKeys } from "@/lib/wallet-keys";

interface CoordinatorRequest {
  request_id: string;
  status: string;
  request_type?: string;
  created_at?: string;
  result?: Record<string, unknown> & { intent_hash?: string; error?: string };
}

const REQUESTS_KEY = "coordinator-requests";

export default function WalletApprovalsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const coordinatorUrl = getCoordinatorApiUrl();

  const { data: requests = [], isLoading } = useQuery<CoordinatorRequest[]>({
    queryKey: [REQUESTS_KEY],
    queryFn: async () => {
      const keys = getAllWalletKeys();
      const firstKey = Object.values(keys)[0]?.apiKey;
      if (!firstKey) return [];

      const resp = await fetch(`${coordinatorUrl}/wallet/v1/requests?limit=50`, {
        headers: { Authorization: `Bearer ${firstKey}` },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.requests ?? data ?? [];
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 size={14} className="text-lime-400" />;
      case "failed":
      case "refunded":
        return <XCircle size={14} className="text-red-400" />;
      case "processing":
      case "pending_deposit":
        return <Loader2 size={14} className="text-cyan-400 animate-spin" />;
      case "pending_approval":
        return <AlertCircle size={14} className="text-amber-400" />;
      default:
        return <Clock size={14} className="text-zinc-400" />;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-lime-400";
      case "failed":
      case "refunded":
        return "text-red-400";
      case "processing":
      case "pending_deposit":
        return "text-cyan-400";
      case "pending_approval":
        return "text-amber-400";
      default:
        return "text-zinc-400";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-20 text-center">
        <p className="text-zinc-500 text-sm">No requests yet.</p>
        <p className="text-zinc-600 text-xs mt-2">
          Transactions and operations will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-24 space-y-2">
      {requests.map((req) => {
        const isExpanded = expandedId === req.request_id;
        const isPending =
          req.status === "processing" ||
          req.status === "pending_deposit" ||
          req.status === "pending_approval";

        return (
          <button
            key={req.request_id}
            onClick={() => setExpandedId(isExpanded ? null : req.request_id)}
            className={`w-full text-left bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 backdrop-blur-sm transition-colors hover:bg-white/[0.06] ${
              isPending ? "ring-1 ring-cyan-500/20" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {statusIcon(req.status)}
                <span className="text-sm text-zinc-200 truncate">
                  {req.request_type || req.result?.intent_hash || req.request_id.slice(0, 12)}
                </span>
              </div>
              <span className={`text-[10px] font-medium ${statusColor(req.status)} uppercase tracking-wider shrink-0`}>
                {req.status.replace(/_/g, " ")}
              </span>
            </div>

            {isExpanded && (
              <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase">ID</p>
                  <p className="text-[11px] text-zinc-300 font-mono break-all">{req.request_id}</p>
                </div>
                {req.created_at && (
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase">Created</p>
                    <p className="text-[11px] text-zinc-400">{new Date(req.created_at).toLocaleString()}</p>
                  </div>
                )}
                {req.result?.intent_hash && (
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase">Tx Hash</p>
                    <p className="text-[11px] text-zinc-300 font-mono break-all">{req.result.intent_hash}</p>
                  </div>
                )}
                {req.result?.error && (
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase">Error</p>
                    <p className="text-[11px] text-red-400 break-all">{req.result.error}</p>
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
