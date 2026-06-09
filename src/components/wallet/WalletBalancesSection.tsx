import { RefreshCw, Wallet, DollarSign } from "lucide-react";
import { useWalletBalances, formatTokenBalance } from "@/hooks/useWalletBalances";
import { Skeleton } from "@/components/ui/skeleton";

interface WalletBalancesSectionProps {
  apiKey: string | null;
  accountId: string | null;
}

function BalanceSkeleton() {
  return (
    <div className="mt-3 pt-3 border-t border-border">
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
    fetching,
    intentsLoading,
    error,
    refetch,
  } = useWalletBalances(apiKey, accountIdRaw);

  const isRefreshing = intentsLoading;

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
      const nearVal = Number(BigInt(near.balance)) / 10 ** 24;
      total += nearVal * nearPrice;
    }
    for (const t of tokens) {
      const price = priceMap[t.defuse_asset_id];
      if (price) {
        const val = Number(t.balance) / 10 ** t.decimals;
        total += val * price;
      }
    }
    return total;
  })();

  if (!apiKey) {
    return (
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Save an API key to view balances.
        </p>
      </div>
    );
  }

  // Show skeleton on first load or while fetching fresh data after a wallet switch
  if ((loading || fetching) && !near && !tokens.length) {
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

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Wallet className="w-3 h-3" />
          Balances
        </span>
        <button
          onClick={() => refetch()}
          className="text-xs text-muted-foreground hover:text-muted-foreground p-0.5"
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
        <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-border">
          <DollarSign className="w-3.5 h-3.5 text-lime-600" />
          <span className="text-sm font-semibold text-foreground">
            ${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-muted-foreground">USD</span>
        </div>
      )}

      {near ? (
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-muted-foreground">NEAR</span>
          <span className="text-xs font-mono font-medium text-foreground">
            {formatNear(near.balance)}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-muted-foreground">NEAR</span>
          <span className="text-xs font-mono font-medium text-foreground">0</span>
        </div>
      )}

      {/* Intents balances */}
      <div className="mt-1.5 pt-1.5 border-t border-border">
        {intentsLoading && tokens.length === 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 border border-border border-t-zinc-500 rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">Loading...</span>
          </div>
        )}

        {tokens.length > 0 && (
          <div className="space-y-0.5">
            {tokens.map((t) => (
              <div
                key={t.defuse_asset_id}
                className="flex items-center justify-between py-0.5"
              >
                <span className="text-xs text-muted-foreground">{t.symbol}</span>
                <span className="text-xs font-mono font-medium text-foreground">
                  {formatTokenBalance(t.balance, t.decimals)}
                </span>
              </div>
            ))}
          </div>
        )}

        {!intentsLoading && tokens.length === 0 && (
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground">USDC</span>
            <span className="text-xs font-mono font-medium text-foreground">0</span>
          </div>
        )}
      </div>
    </div>
  );
}
