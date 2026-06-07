import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchConfidentialBalance,
  fetchIntentsBalancesBatch,
  fetchSupportedTokens,
  type SupportedToken,
  type ConfidentialBalance,
} from "@/lib/api";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getAllWalletKeys } from "@/lib/wallet-keys";

/** Flatten the balance response into a list of { assetId, amount } pairs. */
function flattenBalances(data: ConfidentialBalance | undefined): Array<{ assetId: string; amount: string }> {
  if (!data) return [];
  if (data.items && data.items.length) {
    return data.items.map((i) => ({ assetId: i.asset_id, amount: i.amount }));
  }
  if (data.balances) {
    if (Array.isArray(data.balances)) {
      return (data.balances as Array<Record<string, unknown>>)
        .map((b) => ({
          assetId: String(b.token ?? b.asset_id ?? b.assetId ?? ""),
          amount: String(b.balance ?? b.amount ?? "0"),
        }))
        .filter((b) => b.assetId);
    }
    return Object.entries(data.balances).map(([assetId, amount]) => ({
      assetId,
      amount: typeof amount === "string" ? amount : String((amount as Record<string, unknown>)?.balance ?? "0"),
    }));
  }
  return [];
}

export interface ShieldedToken {
  assetId: string;
  amount: string;
  symbol?: string;
  decimals: number;
  price?: number;
}

export function useConfidentialData() {
  const { accountId, network } = useNearWallet();

  // Derive apiKey from stored keys (same pattern as HomePage)
  const apiKey = useMemo(() => {
    const keys = getAllWalletKeys();
    if (accountId) {
      const match = Object.entries(keys).find(([pk]) => pk === `ed25519:${accountId}`);
      if (match) return match[1].apiKey;
    }
    const first = Object.entries(keys)[0];
    return first ? first[1].apiKey : null;
  }, [accountId]);

  // Token catalog
  const catalogQ = useQuery({
    queryKey: ["supported-tokens"],
    queryFn: fetchSupportedTokens,
    staleTime: 5 * 60_000,
  });
  const tokenCatalog: SupportedToken[] = catalogQ.data ?? [];

  // Confidential balance
  const balQ = useQuery({
    queryKey: ["confidential-balance", apiKey, network],
    queryFn: () => fetchConfidentialBalance(apiKey!),
    enabled: !!apiKey && network === "mainnet",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Decorate shielded items with catalog metadata
  const shieldedItems: ShieldedToken[] = useMemo(() => {
    const raw = flattenBalances(balQ.data);
    return raw
      .filter((i) => i.amount !== "0")
      .map((i) => {
        const tok = tokenCatalog.find((c) => c.defuse_asset_id === i.assetId);
        return {
          ...i,
          symbol: tok?.symbol,
          decimals: tok?.decimals ?? 18,
          price: tok?.price,
        };
      });
  }, [balQ.data, tokenCatalog]);

  // Public intents balance (for shielding)
  const walletAddress = useMemo(() => {
    const keys = getAllWalletKeys();
    if (accountId) {
      const match = Object.entries(keys).find(([pk]) => pk === `ed25519:${accountId}`);
      if (match) return accountId;
    }
    const first = Object.entries(keys)[0];
    return first ? first[0].replace(/^ed25519:/, "") : accountId;
  }, [accountId]);

  const publicBalancesQ = useQuery({
    queryKey: ["public-intents-balance", walletAddress, network],
    queryFn: async () => {
      if (!walletAddress) return [];
      const ids = tokenCatalog.map((t) => t.defuse_asset_id);
      if (ids.length === 0) return [];
      const balances = await fetchIntentsBalancesBatch(walletAddress, ids);
      return ids.map((id, i) => ({ assetId: id, amount: balances[i] ?? "0" }));
    },
    enabled: !!walletAddress && tokenCatalog.length > 0 && network === "mainnet",
    staleTime: 30_000,
  });

  const publicTokens = publicBalancesQ.data ?? [];

  // Compute total shielded USD
  const totalUsd = shieldedItems.reduce((sum, t) => {
    if (!t.price) return sum;
    return sum + Number(t.amount) / 10 ** t.decimals * t.price;
  }, 0);

  return {
    apiKey,
    tokenCatalog,
    shieldedItems,
    publicTokens,
    totalUsd,
    loading: balQ.isPending,
    refetch: () => {
      balQ.refetch();
      publicBalancesQ.refetch();
    },
    error: balQ.error,
  };
}
