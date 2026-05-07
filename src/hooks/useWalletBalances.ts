import { useQuery } from "@tanstack/react-query";
import {
  getCoordinatorApiUrl,
  fetchWalletBalance,
  fetchSupportedTokens,
  fetchIntentsBalancesBatch,
  type WalletBalanceResponse,
  type SupportedToken,
} from "@/lib/api";

export interface TokenBalance {
  symbol: string;
  decimals: number;
  balance: string;
  defuse_asset_id: string;
  chains: string[];
}

function formatTokenBalance(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const value = BigInt(raw);
  if (value === 0n) return "0";

  const divisor = 10n ** BigInt(decimals);
  const intPart = value / divisor;
  const fracPart = value % divisor;

  if (fracPart === 0n) return intPart.toLocaleString();

  const fracStr = fracPart
    .toString()
    .padStart(decimals, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return `${intPart.toLocaleString()}.${fracStr}`;
}

export function useWalletBalances(
  apiKey: string | null | undefined,
  accountId: string | null | undefined,
) {
  const baseUrl = getCoordinatorApiUrl();

  // NEAR balance (on-chain native, requires API key)
  const nearQuery = useQuery({
    queryKey: ["wallet-balance-near", apiKey],
    queryFn: () => fetchWalletBalance(baseUrl, apiKey!),
    enabled: !!apiKey,
    staleTime: 30_000,
  });

  // Token catalog (requires API key — used for symbols/decimals)
  const catalogQuery = useQuery({
    queryKey: ["wallet-supported-tokens", apiKey],
    queryFn: () => fetchSupportedTokens(baseUrl, apiKey!),
    enabled: !!apiKey,
    staleTime: 5 * 60_000,
  });

  // Intents balances — single RPC call via mt_batch_balance_of
  const allTokens = catalogQuery.data ?? [];

  const intentsQuery = useQuery({
    queryKey: ["wallet-intents-balances", accountId, allTokens.length],
    queryFn: async () => {
      if (!accountId || allTokens.length === 0) return [];

      try {
        const tokenIds = allTokens.map((t) => t.defuse_asset_id);
        const balances = await fetchIntentsBalancesBatch(accountId, tokenIds);

        // Pair balances with catalog metadata, filter to non-zero
        return allTokens
          .map((token, i) => ({
            symbol: token.symbol,
            decimals: token.decimals,
            balance: balances[i] ?? "0",
            defuse_asset_id: token.defuse_asset_id,
            chains: token.chains,
          }))
          .filter((t) => t.balance !== "0") as TokenBalance[];
      } catch (err) {
        // Surface error message for display
        throw new Error(
          `Intents balance query failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    enabled: !!accountId && allTokens.length > 0,
    staleTime: 30_000,
  });

  const loading = nearQuery.isLoading;
  const intentsLoading = intentsQuery.isLoading;
  const error = nearQuery.error?.message || intentsQuery.error?.message || null;

  return {
    near: nearQuery.data ?? null,
    tokens: intentsQuery.data ?? [],
    loading,
    intentsLoading,
    error,
    refetch: () => {
      nearQuery.refetch();
      catalogQuery.refetch();
      intentsQuery.refetch();
    },
  };
}

export { formatTokenBalance };
