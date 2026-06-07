import { useState, useMemo } from "react";
import { getCoordinatorApiUrl, fetchSupportedTokens, confidentialSwap, type SupportedToken } from "@/lib/api";
import { getAllWalletKeys } from "@/lib/wallet-keys";
import { useWalletBalances, formatTokenBalance } from "@/hooks/useWalletBalances";
import { useConfidentialData } from "@/hooks/useConfidentialData";
import { useToast } from "@/components/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownUp, Loader2, Wallet, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { TokenPickerModal, type TokenOption } from "@/components/TokenPickerModal";
import TokenIcon from "@/components/TokenIcon";

/** Convert human-readable amount to FT minimal units using decimals */
function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return result.toString();
}

/** Shorten hex address for display */
function shortAddr(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}

/** Format a price number for display */
function formatPrice(price: number | undefined): string {
  if (price == null) return "";
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

export default function WalletSwapPage({ privateMode = false }: { privateMode?: boolean }) {
  const { toast } = useToast();
  const coordinatorUrl = getCoordinatorApiUrl();
  const conf = useConfidentialData();

  // Load all saved wallets from localStorage
  const savedWallets = useMemo(() => {
    const keys = getAllWalletKeys();
    return Object.entries(keys).map(([pubkey, stored]) => ({
      pubkey,
      label: stored.label,
      apiKey: stored.apiKey,
    }));
  }, []);

  // Check for ?key= query param
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeApiKey = savedWallets[selectedIndex]?.apiKey ?? null;
  const activePubkey = savedWallets[selectedIndex]?.pubkey ?? null;
  const balanceAccountId = activePubkey?.replace(/^ed25519:/, "") ?? null;

  // Fetch balances for the selected wallet (gives us tokens with non-zero balance)
  const { tokens, loading, error: balanceError, refetch } = useWalletBalances(
    activeApiKey,
    balanceAccountId,
  );

  // Fetch full token catalog independently (for the picker — shows all tokens, not just ones with balance)
  const catalogQuery = useQuery({
    queryKey: ["swap-token-catalog"],
    queryFn: () => fetchSupportedTokens(),
    staleTime: 120_000,
    retry: 2,
  });
  const catalog = catalogQuery.data ?? [];

  // Build balance lookup: defuse_asset_id -> raw balance string
  // In private mode, use shielded balances instead of public intents.
  const balanceMap = useMemo(() => {
    if (privateMode) {
      const map: Record<string, string> = {};
      for (const t of conf.shieldedItems) {
        map[t.assetId] = t.amount;
      }
      return map;
    }
    const map: Record<string, string> = {};
    for (const t of tokens) {
      map[t.defuse_asset_id] = t.balance;
    }
    // Map wrap.near Intents balance to "near" for swap token list
    const wnear = tokens.find((t) => t.defuse_asset_id === "nep141:wrap.near");
    if (wnear) map["near"] = wnear.balance;
    return map;
  }, [privateMode, conf.shieldedItems, tokens]);

  // Build full token list: all catalog tokens + NEAR, with balances merged in
  const tokenOptions = useMemo((): TokenOption[] => {
    const seen = new Set<string>();
    const options: TokenOption[] = [];

    // NEAR first
    options.push({
      id: "near",
      symbol: "NEAR",
      decimals: 24,
      balance: balanceMap["near"] ?? "0",
      price: catalog.find((t) => t.symbol === "wNEAR")?.price,
    });
    seen.add("near");

    // All catalog tokens (skip wrap.near — already represented as "near" above)
    for (const t of catalog) {
      if (seen.has(t.defuse_asset_id)) continue;
      if (t.defuse_asset_id === "nep141:wrap.near") continue;
      seen.add(t.defuse_asset_id);
      options.push({
        id: t.defuse_asset_id,
        symbol: t.symbol,
        decimals: t.decimals,
        balance: balanceMap[t.defuse_asset_id] ?? "0",
        price: t.price,
      });
    }

    return options;
  }, [catalog, balanceMap]);

  const [tokenInId, setTokenInId] = useState<string>("");
  const [tokenOutId, setTokenOutId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [pickerOpen, setPickerOpen] = useState<"from" | "to" | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  const tokenIn = tokenOptions.find((t) => t.id === tokenInId);
  const tokenOut = tokenOptions.find((t) => t.id === tokenOutId);

  // Estimated output based on token prices
  const estimatedOut = useMemo(() => {
    if (!tokenIn || !tokenOut || !amount.trim()) return null;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return null;
    if (tokenIn.price == null || tokenOut.price == null || tokenIn.price <= 0 || tokenOut.price <= 0) return null;
    const usdValue = parsed * tokenIn.price;
    const outAmount = usdValue / tokenOut.price;
    // Format with appropriate precision
    if (outAmount >= 1) return outAmount.toFixed(2);
    if (outAmount >= 0.0001) return outAmount.toFixed(4);
    return outAmount.toFixed(8);
  }, [tokenIn, tokenOut, amount]);

  // USD value of input amount
  const inputValueUsd = useMemo(() => {
    if (!tokenIn || !amount.trim()) return null;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0 || tokenIn.price == null) return null;
    return parsed * tokenIn.price;
  }, [tokenIn, amount]);

  const displayBalanceIn = useMemo(() => {
    if (!tokenIn) return "0";
    if (tokenIn.id === "near") {
      const val = BigInt(tokenIn.balance);
      const whole = val / 10n ** 24n;
      const remainder = val % 10n ** 24n;
      if (remainder === 0n) return whole.toLocaleString();
      const fracStr = remainder.toString().padStart(24, "0").replace(/0+$/, "");
      return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
    }
    return formatTokenBalance(tokenIn.balance, tokenIn.decimals);
  }, [tokenIn]);

  const handleMax = () => {
    if (!tokenIn) return;
    if (tokenIn.id === "near") {
      const balance = BigInt(tokenIn.balance);
      const reserve = BigInt("450000000000000000000"); // 0.00045 NEAR
      if (balance <= reserve) return;
      const available = balance - reserve;
      const whole = available / 10n ** 24n;
      const remainder = available % 10n ** 24n;
      if (remainder === 0n) {
        setAmount(whole.toString());
      } else {
        const fracStr = remainder.toString().padStart(24, "0").replace(/0+$/, "");
        setAmount(`${whole}.${fracStr}`);
      }
    } else {
      setAmount(formatTokenBalance(tokenIn.balance, tokenIn.decimals));
    }
  };

  const handleSwapTokens = () => {
    const tmp = tokenInId;
    setTokenInId(tokenOutId);
    setTokenOutId(tmp);
    setAmount("");
    setError(null);
  };

  const handleSwap = async () => {
    if (!activeApiKey || !amount.trim() || !tokenIn || !tokenOut) return;

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError("Amount must be a positive number");
      return;
    }

    if (tokenInId === tokenOutId) {
      setError("Cannot swap same token");
      return;
    }

    setSwapping(true);
    setError(null);
    setTxStatus("pending");

    try {
      // Swap API requires defuse_asset_id format for both tokens (no bare "near")
      const toDefuseId = (id: string) => id === "near" ? "nep141:wrap.near" : id;
      const tokenInAsset = toDefuseId(tokenIn.id);
      const tokenOutAsset = toDefuseId(tokenOut.id);
      const minimalUnits = toMinimalUnits(amount, tokenIn.decimals);

      if (privateMode) {
        // Confidential swap
        const result = await confidentialSwap(
          activeApiKey,
          tokenInAsset,
          tokenOutAsset,
          minimalUnits,
        );
        setTxHash(result.tx_hash || null);
        setTxStatus("success");
        toast(`Private swap submitted. Request: ${result.request_id}`);
        setAmount("");
        conf.refetch();
      } else {
        // Public swap
        const resp = await fetch(`${coordinatorUrl}/wallet/v1/intents/swap`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token_in: tokenInAsset,
            token_out: tokenOutAsset,
            amount_in: minimalUnits,
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(errBody || `Swap failed: HTTP ${resp.status}`);
        }

        const result = await resp.json();
        setTxHash(result.transaction_hash || result.tx_hash || null);
        refetch();
      }

      // Clear success after 3s
      setTimeout(() => setTxStatus("idle"), 3000);
    } catch (err) {
      setTxStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setTxStatus("idle"), 3000);
    } finally {
      setSwapping(false);
    }
  };

  const isValid =
    tokenInId !== "" &&
    tokenOutId !== "" &&
    tokenInId !== tokenOutId &&
    amount.trim().length > 0 &&
    !isNaN(parseFloat(amount)) &&
    parseFloat(amount) > 0 &&
    !!activeApiKey;

  if (savedWallets.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4 pb-24 sm:max-w-xl md:max-w-2xl">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
              <ArrowDownUp className="w-7 h-7 text-zinc-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">Swap Tokens</h2>
            <p className="text-zinc-500 text-sm max-w-xs mx-auto">
              Save an API key from the Wallets page to swap tokens via NEAR Intents.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24 sm:max-w-xl md:max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-lime-500/10 flex items-center justify-center">
          <ArrowDownUp className="w-4 h-4 text-lime-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-1.5">
            {privateMode && <Shield size={14} className="text-purple-400" />}
            Swap
          </h1>
          <p className="text-xs text-muted-foreground">
            {privateMode ? "Private swap via confidential intents" : "Swap tokens via NEAR Intents"}
          </p>
        </div>
      </div>

      {/* Wallet selector */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
            Wallet
          </Label>
          <div className="relative">
            <select
              value={selectedIndex}
              onChange={(e) => {
                setSelectedIndex(Number(e.target.value));
                setAmount("");
                setError(null);
              }}
              className="w-full h-11 appearance-none bg-zinc-50 border border-zinc-200 rounded-lg px-3 pr-10 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-lime-500/30 focus:border-lime-500 transition-colors"
            >
              {savedWallets.map((w, i) => {
                const display = w.label || shortAddr(w.pubkey.replace(/^ed25519:/, ""));
                return (
                  <option key={w.pubkey} value={i}>
                    {display}
                  </option>
                );
              })}
            </select>
            <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        </CardContent>
      </Card>

      {balanceError && (
        <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
          <p className="text-sm text-red-400">{balanceError}</p>
        </div>
      )}

      {/* Transaction status banner */}
      {txStatus === "pending" && (
        <div className="mb-4 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          <p className="text-sm text-blue-400">Transaction submitted, confirming...</p>
        </div>
      )}
      {txStatus === "success" && (
        <div className="mb-4 bg-lime-500/10 border-l-4 border-lime-500 rounded-r-lg p-3">
          <p className="text-sm text-lime-400">
            Swap complete! {txHash && (
              <span className="font-mono text-xs opacity-70 block mt-1 break-all">{txHash}</span>
            )}
          </p>
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-4 relative">
          {/* Token In */}
          {catalogQuery.isLoading && tokenOptions.length <= 1 ? (
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                From
              </Label>
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ) : (
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                From
              </Label>
              <button
                type="button"
                onClick={() => setPickerOpen("from")}
                className="w-full h-11 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-lime-500/30 focus:border-lime-500 transition-colors"
              >
                {tokenIn ? (
                  <>
                    <TokenIcon symbol={tokenIn.symbol} size={24} />
                    <span className="flex-1 text-left">{tokenIn.symbol}</span>
                    {tokenIn.price != null && tokenIn.price > 0 && (
                      <span className="text-xs text-muted-foreground">{formatPrice(tokenIn.price)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Select token</span>
                )}
              </button>
            </div>
          )}

          {/* Swap direction button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleSwapTokens}
              className="w-10 h-10 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center hover:bg-zinc-200 transition-colors"
            >
              <ArrowDownUp className="w-4 h-4 text-zinc-600" />
            </button>
          </div>

          {/* Token Out */}
          {catalogQuery.isLoading && tokenOptions.length <= 1 ? (
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                To
              </Label>
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ) : (
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                To
              </Label>
              <button
                type="button"
                onClick={() => setPickerOpen("to")}
                className="w-full h-11 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-lime-500/30 focus:border-lime-500 transition-colors"
              >
                {tokenOut ? (
                  <>
                    <TokenIcon symbol={tokenOut.symbol} size={24} />
                    <span className="flex-1 text-left">{tokenOut.symbol}</span>
                    {tokenOut.price != null && tokenOut.price > 0 && (
                      <span className="text-xs text-muted-foreground">{formatPrice(tokenOut.price)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Select token</span>
                )}
              </button>
            </div>
          )}

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Amount
              </Label>
              {tokenIn && (
                <span className="text-xs text-muted-foreground">
                  Balance: {displayBalanceIn} {tokenIn.symbol}
                </span>
              )}
            </div>
            <div className="relative">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                className="h-11 text-sm pr-16"
              />
              {tokenIn && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleMax();
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-xs font-semibold text-lime-500 hover:text-lime-400 px-2 py-1 rounded-md hover:bg-lime-500/10 transition-colors cursor-pointer"
                >
                  Max
                </button>
              )}
            </div>
            {inputValueUsd != null && (
              <p className="text-xs text-muted-foreground mt-1">≈ {formatPrice(inputValueUsd)}</p>
            )}
          </div>

          {/* Estimated output */}
          {estimatedOut && tokenOut && (
            <div className="bg-zinc-50 border border-zinc-100 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">You receive (est.)</span>
                {inputValueUsd != null && (
                  <span className="text-xs text-muted-foreground">{formatPrice(inputValueUsd)}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <TokenIcon symbol={tokenOut.symbol} size={20} />
                <span className="text-base font-semibold text-foreground">
                  ~{estimatedOut} {tokenOut.symbol}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Based on market prices. Final amount may differ.</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={handleSwap}
            disabled={!isValid || swapping}
            className="w-full h-12 text-sm font-semibold"
          >
            {swapping ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Swapping...
              </>
            ) : (
              <>
                <ArrowDownUp className="w-4 h-4 mr-2" />
                Swap {tokenIn?.symbol || ""} → {tokenOut?.symbol || ""}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Token picker modals */}
      <TokenPickerModal
        open={pickerOpen === "from"}
        onOpenChange={(o) => setPickerOpen(o ? "from" : null)}
        tokens={tokenOptions.filter((t) => t.balance !== "0" && t.balance !== "")}
        selectedId={tokenInId}
        onSelect={(id) => {
          setTokenInId(id);
          setAmount("");
          setError(null);
        }}
        title="Select token to swap"
      />
      <TokenPickerModal
        open={pickerOpen === "to"}
        onOpenChange={(o) => setPickerOpen(o ? "to" : null)}
        tokens={tokenOptions}
        selectedId={tokenOutId}
        onSelect={(id) => {
          setTokenOutId(id);
          setError(null);
        }}
        title="Select token to receive"
      />
    </div>
  );
}
