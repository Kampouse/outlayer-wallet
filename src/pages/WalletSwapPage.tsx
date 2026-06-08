import { useState, useMemo } from "react";
import { getCoordinatorApiUrl, fetchSupportedTokens, confidentialSwap } from "@/lib/api";
import { getAllWalletKeys } from "@/lib/wallet-keys";
import { useWalletBalances, formatTokenBalance } from "@/hooks/useWalletBalances";
import { useConfidentialData } from "@/hooks/useConfidentialData";
import { useToast } from "@/components/ToastProvider";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { ArrowDownUp, Loader2, Wallet, Shield, ChevronDown } from "lucide-react";
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

export default function WalletSwapPage({ privateMode = false, apiKey: propApiKey }: { privateMode?: boolean; apiKey?: string }) {
  const { toast } = useToast();
  const coordinatorUrl = getCoordinatorApiUrl();
  const conf = useConfidentialData();
  const { accountId } = useNearWallet();

  // Load all saved wallets from localStorage
  const savedWallets = useMemo(() => {
    const keys = getAllWalletKeys();
    return Object.entries(keys).map(([pubkey, stored]) => ({
      pubkey,
      label: stored.label,
      apiKey: stored.apiKey,
    }));
  }, []);

  // Default to the wallet matching the active NEAR account, else first
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (!accountId) return 0;
    const idx = savedWallets.findIndex((w) => w.pubkey === `ed25519:${accountId}`);
    return idx >= 0 ? idx : 0;
  });

  // In private mode, always use the apiKey passed from parent (active wallet)
  const activeApiKey = privateMode ? (propApiKey ?? null) : (savedWallets[selectedIndex]?.apiKey ?? null);
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
      // Map wrap.near shielded balance to "near" so the synthetic NEAR entry picks it up
      if (map["nep141:wrap.near"] && !map["near"]) {
        map["near"] = map["nep141:wrap.near"];
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

  const displayBalanceOut = useMemo(() => {
    if (!tokenOut) return "0";
    if (tokenOut.id === "near") {
      const val = BigInt(tokenOut.balance);
      const whole = val / 10n ** 24n;
      const remainder = val % 10n ** 24n;
      if (remainder === 0n) return whole.toLocaleString();
      const fracStr = remainder.toString().padStart(24, "0").replace(/0+$/, "");
      return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
    }
    return formatTokenBalance(tokenOut.balance, tokenOut.decimals);
  }, [tokenOut]);

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

  // Check insufficient balance
  const hasInsufficientBalance = useMemo(() => {
    if (!tokenIn || !amount.trim()) return false;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return false;
    const minimalInput = toMinimalUnits(amount, tokenIn.decimals);
    return BigInt(minimalInput) > BigInt(tokenIn.balance);
  }, [tokenIn, amount]);

  if (savedWallets.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
        <div className="bg-card/50 border border-border rounded-lg p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
            <ArrowDownUp className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Swap Tokens</h2>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            Save an API key from the Wallets page to swap tokens via NEAR Intents.
          </p>
        </div>
      </div>
    );
  }

  const getButtonText = () => {
    if (swapping) return privateMode ? "Signing..." : "Swapping...";
    if (!tokenInId || !tokenOutId) return "Select tokens";
    if (tokenInId === tokenOutId) return "Select different tokens";
    if (!amount.trim() || parseFloat(amount) <= 0) return "Enter amount";
    if (hasInsufficientBalance) return "Insufficient Balance";
    return privateMode ? "Private Swap" : "Swap";
  };

  const buttonDisabled = !isValid || swapping || hasInsufficientBalance;

  return (
    <div className="pb-2">
      {/* Header — wallet selector inline */}
      {!privateMode && savedWallets.length > 1 && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {privateMode && <Shield size={14} className="text-purple-400" />}
            <span className="text-sm text-muted-foreground">Swap</span>
          </div>
          <div className="relative">
            <select
              value={selectedIndex}
              onChange={(e) => {
                setSelectedIndex(Number(e.target.value));
                setAmount("");
                setError(null);
              }}
              className="h-8 appearance-none bg-muted border border-border rounded-lg px-2 pr-7 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {savedWallets.map((w, i) => (
                <option key={w.pubkey} value={i} className="bg-zinc-900 text-white">
                  {w.label || shortAddr(w.pubkey.replace(/^ed25519:/, ""))}
                </option>
              ))}
            </select>
            <Wallet className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      )}

      {balanceError && (
        <div className="mb-3 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
          <p className="text-sm text-red-400">{balanceError}</p>
        </div>
      )}

      {/* Status banners */}
      {txStatus === "pending" && (
        <div className="mb-3 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          <p className="text-sm text-blue-400">Transaction submitted, confirming...</p>
        </div>
      )}
      {txStatus === "success" && (
        <div className="mb-3 bg-lime-500/10 border-l-4 border-lime-500 rounded-r-lg p-3">
          <p className="text-sm text-lime-400">
            Swap complete! {txHash && (
              <span className="font-mono text-xs opacity-70 block mt-1 break-all">{txHash}</span>
            )}
          </p>
        </div>
      )}

      {/* Two stacked cards */}
      <div className="flex flex-col items-center">
        {/* SELL card */}
        <div
          className="flex flex-col bg-card/50 border border-border/50 rounded-lg w-full p-3.5"
        >
          <div className="text-sm text-muted-foreground w-full mb-1.5">Sell</div>
          <div className="flex items-center justify-between w-full gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen("from")}
              className="flex items-center cursor-pointer flex-shrink-0 gap-1"
            >
              {tokenIn ? (
                <>
                  <TokenIcon symbol={tokenIn.symbol} size={26} />
                  <span className="text-foreground font-bold text-base ml-1.5 mr-2">{tokenIn.symbol}</span>
                </>
              ) : (
                <span className="text-muted-foreground text-sm mr-2">Select</span>
              )}
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(null); }}
              className="flex-grow w-1 bg-transparent outline-none font-bold text-foreground text-2xl text-right min-w-0 placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center justify-between w-full text-sm text-muted-foreground mt-3">
            <div className="flex items-center gap-1">
              Balance:
              <button
                type="button"
                onClick={handleMax}
                className="underline cursor-pointer hover:text-foreground"
              >
                {tokenIn ? displayBalanceIn : "0"}
              </button>
            </div>
            {inputValueUsd != null && <span>{formatPrice(inputValueUsd)}</span>}
          </div>
        </div>

        {/* Swap direction button — overlaps both cards */}
        <button
          type="button"
          onClick={handleSwapTokens}
          className="flex items-center justify-center rounded-lg w-7 h-7 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted bg-card/50 -my-3.5 relative z-[4] border-2 border-background"
        >
          <ArrowDownUp className="w-3 h-3" />
        </button>

        {/* BUY card */}
        <div
          className="flex flex-col bg-card/50 border border-border/50 rounded-lg w-full p-3.5 mt-[3px]"
        >
          <div className="text-sm text-muted-foreground w-full mb-1.5">Buy</div>
          <div className="flex items-center justify-between w-full gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen("to")}
              className="flex items-center cursor-pointer flex-shrink-0 gap-1"
            >
              {tokenOut ? (
                <>
                  <TokenIcon symbol={tokenOut.symbol} size={26} />
                  <span className="text-foreground font-bold text-base ml-1.5 mr-2">{tokenOut.symbol}</span>
                </>
              ) : (
                <span className="text-muted-foreground text-sm mr-2">Select</span>
              )}
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            <div className="flex-grow text-right font-bold text-foreground text-2xl min-w-0">
              {estimatedOut ?? <span className="text-muted-foreground">0.0</span>}
            </div>
          </div>
          <div className="flex items-center justify-between w-full text-sm text-muted-foreground mt-3">
            <div className="flex items-center gap-1">
              Balance:
              <span>{tokenOut ? displayBalanceOut : "0"}</span>
            </div>
            {estimatedOut && inputValueUsd != null && <span>{formatPrice(inputValueUsd)}</span>}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSwap}
        disabled={buttonDisabled}
        className={`mt-4 flex items-center justify-center w-full font-bold text-base transition-all rounded-lg ${
          buttonDisabled
            ? "bg-muted text-muted-foreground cursor-not-allowed"
            : privateMode
              ? "bg-purple-500 hover:bg-purple-400 text-white cursor-pointer"
              : "bg-foreground hover:bg-foreground/90 text-background cursor-pointer"
        }`}
        style={{ height: 46 }}
      >
        {swapping ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          getButtonText()
        )}
      </button>

      {privateMode && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Runs asynchronously via confidential intents.
        </p>
      )}

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
