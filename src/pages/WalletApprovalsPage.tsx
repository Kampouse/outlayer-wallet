import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Clock, CheckCircle2, XCircle, AlertCircle, ArrowUpRight } from "lucide-react";
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
  const queryClient = useQueryClient();
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
    refetchInterval: 5_000,
    staleTime: 3_000,
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

  const pending = requests.filter(
    (r) =>
      r.status === "processing" ||
      r.status === "pending_deposit" ||
      r.status === "pending_approval",
  );
  const completed = requests.filter(
    (r) =>
      r.status === "success" ||
      r.status === "failed" ||
      r.status === "refunded",
  );

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
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-24 space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((req) => (
            <RequestRow
              key={req.request_id}
              req={req}
              expanded={expandedId === req.request_id}
              onToggle={() =>
                setExpandedId(expandedId === req.request_id ? null : req.request_id)
              }
              statusIcon={statusIcon}
              statusColor={statusColor}
              onRefresh={() => queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] })}
            />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-2">
          {pending.length > 0 && (
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider px-1">History</p>
          )}
          {completed.slice(0, 20).map((req) => (
            <RequestRow
              key={req.request_id}
              req={req}
              expanded={expandedId === req.request_id}
              onToggle={() =>
                setExpandedId(expandedId === req.request_id ? null : req.request_id)
              }
              statusIcon={statusIcon}
              statusColor={statusColor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestRow({
  req,
  expanded,
  onToggle,
  statusIcon,
  statusColor,
  onRefresh,
}: {
  req: CoordinatorRequest;
  expanded: boolean;
  onToggle: () => void;
  statusIcon: (s: string) => React.ReactNode;
  statusColor: (s: string) => string;
  onRefresh?: () => void;
}) {
  const isPending =
    req.status === "processing" ||
    req.status === "pending_deposit" ||
    req.status === "pending_approval";

  const label =
    req.request_type ||
    req.result?.intent_hash?.slice(0, 10) ||
    req.request_id.slice(0, 8);

  const explorerUrl = req.result?.intent_hash
    ? `https://nearblocks.io/zh-tw/tx/${req.result.intent_hash}`
    : null;

  return (
    <button
      onClick={onToggle}
      className={`w-full text-left bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 backdrop-blur-sm transition-colors hover:bg-white/[0.06] ${
        isPending ? "ring-1 ring-cyan-500/20" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {statusIcon(req.status)}
          <span className="text-sm text-zinc-200 truncate font-mono">{label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <ArrowUpRight size={12} />
            </a>
          )}
          <span className={`text-[10px] font-medium ${statusColor(req.status)} uppercase tracking-wider`}>
            {req.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {expanded && (
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
          {onRefresh && isPending && (
            <div className="pt-1">
              <span className="text-[10px] text-cyan-400/60">Auto-refreshing...</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
