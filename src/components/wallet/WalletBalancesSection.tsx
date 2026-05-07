import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { useWalletBalances, formatTokenBalance } from "@/hooks/useWalletBalances";

interface WalletBalancesSectionProps {
  apiKey: string | null;
  accountId: string | null;
}

export default function WalletBalancesSection({
  apiKey,
  accountId,
}: WalletBalancesSectionProps) {
  // Strip "ed25519:" prefix from pubkey if present — the contract expects raw hex
  const accountIdRaw = accountId?.replace(/^ed25519:/, "") ?? null;

  const {
    near,
    tokens,
    loading,
    intentsLoading,
    error,
    refetch,
  } = useWalletBalances(apiKey, accountIdRaw);

  if (!apiKey) {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-100">
        <p className="text-xs text-zinc-400">
          Save an API key to view balances.
        </p>
      </div>
    );
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

  const isRefreshing = loading || intentsLoading;

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

      {error && <p className="text-xs text-red-500 mb-1">{error}</p>}

      {/* NEAR on-chain balance */}
      {loading && !near ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          NEAR...
        </div>
      ) : near ? (
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
            <Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-400" />
          )}
        </div>

        {intentsLoading && (
          <p className="text-xs text-zinc-400">Querying on-chain...</p>
        )}

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
