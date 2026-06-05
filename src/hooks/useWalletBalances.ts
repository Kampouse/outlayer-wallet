import { useQuery } from "@tanstack/react-query";
import {
  fetchSupportedTokens,
  fetchIntentsBalancesBatch,
  fetchRheaTokenPrices,
  fetchBaseChainBalances,
  getCoordinatorApiUrl,
  type SupportedToken,
} from "@/lib/api";
import { fetchNearAccountBalance } from "@/lib/near-rpc";

export interface TokenBalance {
  symbol: string;
  decimals: number;
  balance: string;
  defuse_asset_id: string;
  chains: string[];
  price?: number;
  /** If true, this token is only on base chain (not deposited into Intents) */
  baseChainOnly?: boolean;
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
    .replace(/0+$/, "");
  return fracStr ? `${intPart.toLocaleString()}.${fracStr}` : intPart.toLocaleString();
}

/**
 * Fetch FT balance via backend proxy (avoids browser CORS with NEAR RPC).
 * @deprecated Use fetchBaseChainBalances for batch instead.
 */
async function fetchFtBalanceRpc(
  _accountId: string,
  _contractId: string,
): Promise<string> {
  // This is no longer called directly — kept for reference.
  // All base chain balance checks go through the backend proxy.
  return "0";
}

export function useWalletBalances(
  apiKey: string | null | undefined,
  accountId: string | null | undefined,
) {
  // NEAR balance — direct from NEAR RPC, no API key needed
  const nearQuery = useQuery({
    queryKey: ["wallet-balance-near", accountId],
    queryFn: async () => {
      if (!accountId) return null;
      const yocto = await fetchNearAccountBalance(accountId);
      return { balance: yocto, token: "NEAR", account_id: accountId };
    },
    enabled: !!accountId,
    staleTime: 30_000,
  });

  // Token catalog from ChainDefuser (public, includes prices, no API key)
  const catalogQuery = useQuery({
    queryKey: ["wallet-supported-tokens"],
    queryFn: () => fetchSupportedTokens(),
    staleTime: 60_000,
  });

  // Rhea token prices — supplementary source for base chain tokens
  const rheaQuery = useQuery({
    queryKey: ["rhea-token-prices"],
    queryFn: fetchRheaTokenPrices,
    staleTime: 60_000,
  });

  // Intents balances — single RPC call via mt_batch_balance_of
  const allTokens = catalogQuery.data ?? [];

  const intentsQuery = useQuery({
    queryKey: ["wallet-intents-balances", accountId, allTokens.length],
    queryFn: async () => {
      if (!accountId || allTokens.length === 0) return [];

      let balances: string[];
      try {
        const tokenIds = allTokens.map((t) => t.defuse_asset_id);
        balances = await fetchIntentsBalancesBatch(accountId, tokenIds);
      } catch (e) {
        console.warn("Failed to fetch balances:", e);
        balances = allTokens.map(() => "0");
      }

      return allTokens
        .map((token, i) => ({
          symbol: token.symbol,
          decimals: token.decimals,
          balance: balances[i] ?? "0",
          defuse_asset_id: token.defuse_asset_id,
          chains: token.chains,
          price: token.price,
        }))
        .filter((t) => t.balance !== "0") as TokenBalance[];
    },
    enabled: !!accountId && allTokens.length > 0,
    staleTime: 30_000,
  });

  // ── Base chain balances from Rhea tokens ──
  // Finds tokens the user holds on base chain that ChainDefuser doesn't cover
  const baseChainQuery = useQuery({
    queryKey: ["base-chain-rhea-balances", accountId, rheaQuery.data],
    queryFn: async () => {
      if (!accountId || !rheaQuery.data) return [];

      const rheaTokens = rheaQuery.data;

      // Build set of ChainDefuser contract IDs (strip nep141: prefix)
      const defuseContractIds = new Set(
        allTokens.map((t) => {
          const id = t.defuse_asset_id;
          return id.startsWith("nep141:") ? id.slice("nep141:".length) : id;
        }),
      );

      // Also exclude tokens already in Intents (they're already shown)
      const intentsAssetIds = new Set(
        (intentsQuery.data ?? []).map((t) => t.defuse_asset_id),
      );

      // Filter Rhea tokens: not in ChainDefuser, not in Intents, price > $0.001, reasonable symbol
      const candidates: Array<{ contractId: string; symbol: string; price: number; decimal: number }> = [];
      for (const [contractId, info] of Object.entries(rheaTokens)) {
        if (defuseContractIds.has(contractId)) continue;
        if (info.price < 0.001) continue;
        if (!info.symbol || info.symbol.length > 10) continue;
        candidates.push({ contractId, ...info });
      }

      // Cap at 60 to match backend limit
      const toCheck = candidates.slice(0, 60);
      const contractIds = toCheck.map((t) => t.contractId);

      // Single backend call — no CORS issues
      const balances = await fetchBaseChainBalances(accountId, contractIds);

      // Map results back to TokenBalance
      const results: TokenBalance[] = [];
      for (const t of toCheck) {
        const bal = balances[t.contractId];
        if (bal && bal !== "0") {
          results.push({
            symbol: t.symbol,
            decimals: t.decimal,
            balance: bal,
            defuse_asset_id: `nep141:${t.contractId}`,
            chains: ["near"],
            price: t.price,
            baseChainOnly: true,
          });
        }
      }

      return results;
    },
    enabled: !!accountId && !!rheaQuery.data,
    staleTime: 10_000,
  });

  const loading = nearQuery.isLoading;
  const fetching = nearQuery.isFetching || intentsQuery.isFetching || baseChainQuery.isFetching;
  const intentsLoading = intentsQuery.isLoading;
  const error = nearQuery.error?.message || intentsQuery.error?.message || null;

  const intentsTokens = (intentsQuery.data ?? []).filter((t) => !t.baseChainOnly);
  const baseChainTokens = baseChainQuery.data ?? [];

  return {
    near: nearQuery.data ?? null,
    tokens: intentsTokens,
    baseChainTokens,
    allTokens,
    loading,
    fetching,
    intentsLoading,
    baseChainLoading: baseChainQuery.isLoading,
    error,
    refetch: () => {
      nearQuery.refetch();
      catalogQuery.refetch();
      intentsQuery.refetch();
      baseChainQuery.refetch();
    },
  };
}

export { formatTokenBalance };
