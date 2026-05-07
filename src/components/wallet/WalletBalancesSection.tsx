import { RefreshCw, Wallet, DollarSign } from "lucide-react";
import { useWalletBalances, formatTokenBalance } from "@/hooks/useWalletBalances";
import { Skeleton } from "@/components/ui/skeleton";

interface WalletBalancesSectionProps {
  apiKey: string | null;
  accountId: string | null;
}

function BalanceSkeleton() {
  return (
    <div className="mt-3 pt-3 border-t border-zinc-100">
      <div className="flex items-center justify-between mb-2">
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between py-0.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex items-center justify-between py-0.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

export default function WalletBalancesSection({
  apiKey,
  accountId,
}: WalletBalancesSectionProps) {
  const accountIdRaw = accountId?.replace(/^ed25519:/, "") ?? null;

  const {
    near,
    tokens,
    allTokens,
    loading,
    intentsLoading,
    error,
    refetch,
  } = useWalletBalances(apiKey, accountIdRaw);

  // Build a quick price lookup from the catalog
  const priceMap: Record<string, number> = {};
  for (const t of allTokens) {
    if (t.price != null && t.price > 0) {
      priceMap[t.defuse_asset_id] = t.price;
    }
  }

  // Calculate total USD value
  const totalUsd = (() => {
    let total = 0;
    // NEAR price from catalog (wNEAR has NEAR price)
    const wnear = allTokens.find((t) => t.symbol === "wNEAR");
    const nearPrice = wnear?.price ?? priceMap["nep141:wrap.near"] ?? 0;
    if (near && nearPrice > 0) {
      const nearVal = Number(BigInt(near.balance) / 10n ** 24n);
      total += nearVal * nearPrice;
    }
    for (const t of tokens) {
      const price = priceMap[t.defuse_asset_id];
      if (price) {
        const val = BigInt(t.balance) / 10n ** BigInt(t.decimals);
        total += Number(val) * price;
      }
    }
    return total;
  })();

  if (!apiKey) {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-100">
        <p className="text-xs text-zinc-400">
          Save an API key to view balances.
        </p>
      </div>
    );
  }

  if (loading && !near && !tokens.length) {
    return <BalanceSkeleton />;
  }

  const formatNear = (raw: string) => {
    if (!raw || raw === "0") return "0 NEAR";
    const value = BigInt(raw);
    const whole = value / 10n ** 24n;
    const frac = value % 10n ** 24n;
    if (frac === 0n) return `${whole.toLocaleString()} NEAR`;
    const fracStr = frac
      .toString()
      .padStart(24, "0")
      .slice(0, 4)
      .replace(/0+$/, "");
    return `${whole.toLocaleString()}.${fracStr} NEAR`;
  };

  const isRefreshing = intentsLoading;

  return (
    <div className="mt-3 pt-3 border-t border-zinc-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-600 flex items-center gap-1.5">
          <Wallet className="w-3 h-3" />
          Balances
        </span>
        <button
          onClick={() => refetch()}
          className="text-xs text-zinc-400 hover:text-zinc-600 p-0.5"
          title="Refresh balances"
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Total USD value */}
      {totalUsd > 0 && (
        <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-zinc-100">
          <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-sm font-semibold text-zinc-900">
            ${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-zinc-400">USD</span>
        </div>
      )}

      {error && <p className="text-xs text-red-500 mb-1">{error}</p>}

      {/* NEAR on-chain balance */}
      {near ? (
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-zinc-500">NEAR</span>
          <span className="text-xs font-mono font-medium text-zinc-800">
            {formatNear(near.balance)}
          </span>
        </div>
      ) : null}

      {/* Intents balances */}
      <div className="mt-1.5 pt-1.5 border-t border-zinc-50">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Intents
          </span>
          {intentsLoading && (
            <div className="w-3 h-3 border border-zinc-300 border-t-zinc-500 rounded-full animate-spin" />
          )}
        </div>

        {tokens.length > 0 && (
          <div className="space-y-0.5">
            {tokens.map((t) => (
              <div
                key={t.defuse_asset_id}
                className="flex items-center justify-between py-0.5"
              >
                <span className="text-xs text-zinc-500">
                  {t.symbol}
                  {t.chains.length > 0 && (
                    <span className="text-zinc-300 ml-1">
                      {t.chains[0]}
                    </span>
                  )}
                </span>
                <span className="text-xs font-mono font-medium text-zinc-800">
                  {formatTokenBalance(t.balance, t.decimals)}
                </span>
              </div>
            ))}
          </div>
        )}

        {!intentsLoading && tokens.length === 0 && (
          <p className="text-xs text-zinc-400">No intents balances</p>
        )}
      </div>
    </div>
  );
}
