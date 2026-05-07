import { useQuery } from "@tanstack/react-query";

interface PriceMap {
  [symbol: string]: number; // USD price per 1 token
}

const COINGECKO_IDS: Record<string, string> = {
  NEAR: "near",
  USDC: "usd-coin",
  USDT: "tether",
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DAI: "dai",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  ARB: "arbitrum",
  OP: "optimism",
  BNB: "binancecoin",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  DOGE: "dogecoin",
  FIL: "filecoin",
};

/**
 * Fetch USD prices for common tokens via CoinGecko free API.
 * Caches for 2 minutes. Returns map of symbol → price.
 */
export function useTokenPrices(symbols: string[]) {
  const idsToFetch = [...new Set(
    symbols
      .map((s) => COINGECKO_IDS[s.toUpperCase()])
      .filter(Boolean),
  )].join(",");

  return useQuery<PriceMap>({
    queryKey: ["token-prices", idsToFetch],
    queryFn: async () => {
      if (!idsToFetch) return {};

      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${idsToFetch}&vs_currencies=usd`,
      );
      if (!resp.ok) throw new Error("Price fetch failed");

      const data = await resp.json();

      // Map coingecko IDs back to symbols
      const prices: PriceMap = {};
      for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
        if (data[id]?.usd != null) {
          prices[symbol] = data[id].usd;
        }
      }
      return prices;
    },
    enabled: idsToFetch.length > 0,
    staleTime: 2 * 60_000,
    retry: 1,
  });
}
