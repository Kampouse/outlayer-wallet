import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { getCoordinatorApiUrl } from "@/lib/api";
import { getAllWalletKeys, unlockWalletKeyWithPasskey, isPasskeyProtected } from "@/lib/wallet-keys";
import { useWalletBalances, formatTokenBalance } from "@/hooks/useWalletBalances";
import { useToast } from "@/components/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SendHorizontal,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  Info,
  ShieldCheck,
  Lock,
  Fingerprint,
} from "lucide-react";
import { TokenPickerModal, type TokenOption } from "@/components/TokenPickerModal";

/** Convert human-readable NEAR amount to yoctoNEAR string */
function nearToYocto(amount: string): string {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) throw new Error("Invalid amount");
  const yocto = BigInt(Math.round(parsed * 1e6)) * BigInt(1e18);
  return yocto.toString();
}

/** Convert human-readable amount to FT minimal units using decimals */
function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return result.toString();
}

/** Format yoctoNEAR to human-readable NEAR */
function formatYoctoToNear(yocto: string): string {
  if (!yocto || yocto === "0") return "0";
  const value = BigInt(yocto);
  const whole = value / 10n ** 24n;
  const remainder = value % 10n ** 24n;
  if (remainder === 0n) return whole.toLocaleString();
  const fracStr = remainder
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

/** Shorten hex address for display */
function shortAddr(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}

/** Deterministic color from symbol */
function tokenColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

/** Gas reserve for NEAR transfers/deposits (0.00045 NEAR) */
const NEAR_GAS_RESERVE = "450000000000000000000";

type Mode = "withdraw" | "deposit";

export default function WalletSendPage() {
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const { toast } = useToast();
  const coordinatorUrl = getCoordinatorApiUrl();

  // Mode selector
  const [mode, setMode] = useState<Mode>("withdraw");

  // Load all saved wallets from localStorage
  const [unlockedKeys, setUnlockedKeys] = useState<Record<string, string>>({});
  const [unlockingPubkey, setUnlockingPubkey] = useState<string | null>(null);

  const savedWallets = useMemo(() => {
    const keys = getAllWalletKeys();
    return Object.entries(keys).map(([pubkey, stored]) => ({
      pubkey,
      label: stored.label,
      apiKey: stored.apiKey || unlockedKeys[pubkey] || "",
      passkeyProtected: stored.passkeyProtected && !unlockedKeys[pubkey],
    }));
  }, [unlockedKeys]);

  const handleUnlock = async (pubkey: string) => {
    setUnlockingPubkey(pubkey);
    const key = await unlockWalletKeyWithPasskey(pubkey);
    if (key) {
      setUnlockedKeys((prev) => ({ ...prev, [pubkey]: key }));
    }
    setUnlockingPubkey(null);
  };

  // Check for ?key= query param — use that wallet if it matches a saved key
  const urlKey = searchParams.get("key");

  // Selected wallet index
  const [selectedIndex, setSelectedIndex] = useState(0);
  const initialIndexSet = useMemo(() => {
    if (!urlKey) return -1;
    const idx = savedWallets.findIndex((w) => w.apiKey === urlKey);
    return idx;
  }, [urlKey, savedWallets]);

  useEffect(() => {
    if (initialIndexSet >= 0) setSelectedIndex(initialIndexSet);
  }, [initialIndexSet]);

  // If ?key= doesn't match any saved wallet, use it directly
  const directApiKey = urlKey && initialIndexSet < 0 ? urlKey : null;

  // The active API key and pubkey for the selected wallet
  const activeApiKey = savedWallets[selectedIndex]?.apiKey ?? directApiKey ?? null;
  const activePubkey = savedWallets[selectedIndex]?.pubkey ?? null;
  const balanceAccountId = activePubkey?.replace(/^ed25519:/, "") ?? null;

  // Withdraw mode: Intents balances (pubkey-based, same as manage page)
  const { near, tokens, allTokens, loading, error: balanceError, refetch } = useWalletBalances(
    activeApiKey,
    balanceAccountId,
  );

  // Base chain FT balances via OutLayer API (for deposit mode)
  // NEAR base chain balance is already available from `near` (RPC view_account).
  // For FTs on base chain, we query /wallet/v1/balance per NEAR-chain token
  // that has a non-zero Intents balance (likely very few).
  const nearChainTokens = useMemo(
    () =>
      allTokens
        .filter((t) => t.chains.includes("near") && !t.defuse_asset_id.includes("wrap.near"))
        .slice(0, 20), // cap to avoid too many API calls
    [allTokens],
  );

  const baseFtQuery = useQuery({
    queryKey: ["base-chain-ft-balances", activeApiKey, nearChainTokens.length],
    queryFn: async () => {
      if (!activeApiKey || nearChainTokens.length === 0) return {};
      const results: Record<string, string> = {};
      const contractIds = nearChainTokens.map((t) => {
        const id = t.defuse_asset_id;
        return id.startsWith("nep141:") ? id.slice("nep141:".length) : id;
      });
      // Batch: query up to 10 at a time
      for (let i = 0; i < contractIds.length; i += 10) {
        const batch = contractIds.slice(i, i + 10);
        const entries = await Promise.allSettled(
          batch.map(async (contract, j) => {
            const token = nearChainTokens[i + j];
            const resp = await fetch(
              `${coordinatorUrl}/wallet/v1/balance?chain=near&token=${encodeURIComponent(contract)}`,
              { headers: { Authorization: `Bearer ${activeApiKey}` } },
            );
            if (!resp.ok) return null;
            const data = await resp.json();
            return { assetId: token.defuse_asset_id, balance: data.balance as string };
          }),
        );
        for (const entry of entries) {
          if (entry.status === "fulfilled" && entry.value && entry.value.balance !== "0") {
            results[entry.value.assetId] = entry.value.balance;
          }
        }
      }
      return results;
    },
    enabled: mode === "deposit" && !!activeApiKey && nearChainTokens.length > 0,
    staleTime: 0,
  });

  // Form state
  const [selectedToken, setSelectedToken] = useState<string>("NEAR");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null);

  // Reset form when wallet or mode changes
  useEffect(() => {
    setSelectedToken("NEAR");
    setAmount("");
    setRecipient("");
    setError(null);
    setEstimatedFee(null);
    setTxStatus("idle");
    setTxHash(null);
  }, [activeApiKey, mode]);

  // Loading state based on mode
  const isTokenLoading =
    mode === "withdraw"
      ? loading
      : loading || baseFtQuery.isLoading;

  // Build token options based on mode
  const tokenOptions = useMemo(() => {
    if (mode === "withdraw") {
      const options = [
        { id: "NEAR", symbol: "NEAR", decimals: 24, balance: near?.balance ?? "0", chain: "near" as const, contractId: "" },
      ];
      for (const t of tokens) {
        options.push({
          id: t.defuse_asset_id,
          symbol: t.symbol,
          decimals: t.decimals,
          balance: t.balance,
          chain: t.chains[0] ?? "near",
          contractId: "",
        });
      }
      return options;
    }

    // Deposit mode: base chain balances
    // NEAR from RPC (already fetched), FTs from OutLayer /wallet/v1/balance
    const options: Array<{
      id: string; symbol: string; decimals: number; balance: string; chain: string; contractId: string;
    }> = [];
    const ftBalances = baseFtQuery.data ?? {};

    // NEAR — same RPC balance as withdraw mode (this IS the base chain balance)
    options.push({
      id: "NEAR",
      symbol: "NEAR",
      decimals: 24,
      balance: near?.balance ?? "0",
      chain: "near",
      contractId: "wrap.near",
    });

    // FTs with non-zero base chain balance
    for (const t of nearChainTokens) {
      const bal = ftBalances[t.defuse_asset_id];
      if (!bal) continue;
      const contractId = t.defuse_asset_id.startsWith("nep141:")
        ? t.defuse_asset_id.slice("nep141:".length)
        : t.defuse_asset_id;
      options.push({
        id: t.defuse_asset_id,
        symbol: t.symbol,
        decimals: t.decimals,
        balance: bal,
        chain: t.chains[0] ?? "near",
        contractId,
      });
    }

    return options;
  }, [mode, near, tokens, baseFtQuery.data, nearChainTokens]);

  const selected = tokenOptions.find((t) => t.id === selectedToken);

  // Format balance for display
  const displayBalance = useMemo(() => {
    if (!selected) return "0";
    if (selected.id === "NEAR") {
      return formatYoctoToNear(selected.balance);
    }
    return formatTokenBalance(selected.balance, selected.decimals);
  }, [selected]);

  // Max amount (for NEAR, subtract gas reserve)
  const maxAmount = useMemo(() => {
    if (!selected) return "0";
    try {
      if (selected.id === "NEAR") {
        const bal = BigInt(selected.balance);
        const reserve = BigInt(NEAR_GAS_RESERVE);
        if (bal <= reserve) return "0";
        return formatYoctoToNear((bal - reserve).toString());
      }
      return formatTokenBalance(selected.balance, selected.decimals);
    } catch {
      return "0";
    }
  }, [selected]);

  const handleMax = () => {
    setAmount(maxAmount);
  };

  const handleSubmit = async () => {
    if (!activeApiKey || !amount.trim() || !selected) return;
    if (mode === "withdraw" && !recipient.trim()) return;

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError("Amount must be a positive number");
      return;
    }

    setSending(true);
    setError(null);
    setTxStatus("pending");

    try {
      let result: Record<string, unknown> | null = null;

      if (mode === "deposit") {
        // Deposit to Intents — move from base chain to Intents
        const minimalUnits =
          selected.id === "NEAR"
            ? nearToYocto(amount)
            : toMinimalUnits(amount, selected.decimals);
        const token = selected.contractId; // "wrap.near" for NEAR, contract name for FTs

        const resp = await fetch(`${coordinatorUrl}/wallet/v1/intents/deposit`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token, amount: minimalUnits }),
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(errBody || `Deposit failed: HTTP ${resp.status}`);
        }

        result = await resp.json().catch(() => null);
        if (result?.status === "failed") {
          throw new Error("Deposit transaction failed on-chain");
        }
      } else if (selected.id === "NEAR") {
        // Transfer NEAR (withdraw mode)
        const yoctoAmount = nearToYocto(amount);
        const resp = await fetch(`${coordinatorUrl}/wallet/v1/transfer`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ receiver_id: recipient.trim(), amount: yoctoAmount }),
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(errBody || `Transfer failed: HTTP ${resp.status}`);
        }
        result = await resp.json().catch(() => null);
      } else {
        // Withdraw Intents token (dry-run first, then execute)
        const assetId = selected.id;
        const contractName = assetId.startsWith("nep141:")
          ? assetId.slice("nep141:".length)
          : assetId;
        const minimalUnits = toMinimalUnits(amount, selected.decimals);
        const withdrawBody = {
          to: recipient.trim(),
          amount: minimalUnits,
          token: contractName,
          chain: selected.chain,
        };

        // Dry-run to validate before submitting
        const dryRun = await fetch(
          `${coordinatorUrl}/wallet/v1/intents/withdraw/dry-run`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${activeApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(withdrawBody),
          },
        );
        const dryResult = await dryRun.json();
        if (!dryRun.ok || dryResult.would_succeed === false) {
          throw new Error(
            dryResult.message || dryResult.error || "Dry-run failed",
          );
        }
        if (dryResult.estimated_fee) {
          setEstimatedFee(dryResult.estimated_fee);
        }
        if (dryResult.fee_token) {
          setEstimatedFee((prev) =>
            prev ? `${prev} ${dryResult.fee_token}` : null,
          );
        }

        // Execute the actual withdraw
        const resp = await fetch(`${coordinatorUrl}/wallet/v1/intents/withdraw`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(withdrawBody),
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(errBody || `Withdraw failed: HTTP ${resp.status}`);
        }
        result = await resp.json().catch(() => null);
      }

      // Success
      setTxHash((result?.transaction_hash || result?.tx_hash) as string ?? null);
      setTxStatus("success");
      toast(
        mode === "deposit"
          ? `Deposited ${amount} ${selected.symbol} to Intents`
          : `Sent ${amount} ${selected.symbol} successfully`,
      );
      setAmount("");
      setRecipient("");
      refetch();
      if (mode === "deposit") baseFtQuery.refetch();
      setTimeout(() => setTxStatus("idle"), 3000);
    } catch (err) {
      setTxStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setTxStatus("idle"), 3000);
    } finally {
      setSending(false);
    }
  };

  // Check if amount exceeds available balance
  const amountExceedsBalance = useMemo(() => {
    if (!selected || !amount.trim()) return false;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return false;
    try {
      if (selected.id === "NEAR") {
        const yoctoAmount = BigInt(nearToYocto(amount));
        const balance = BigInt(selected.balance);
        return yoctoAmount > balance;
      } else {
        const minimalAmount = BigInt(toMinimalUnits(amount, selected.decimals));
        const balance = BigInt(selected.balance);
        return minimalAmount > balance;
      }
    } catch {
      return false;
    }
  }, [selected, amount]);

  const isValid =
    (mode === "deposit" || recipient.trim().length > 0) &&
    amount.trim().length > 0 &&
    !isNaN(parseFloat(amount)) &&
    parseFloat(amount) > 0 &&
    !!activeApiKey &&
    !amountExceedsBalance;

  // No wallets saved state
  if (savedWallets.length === 0 && !directApiKey) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
              <SendHorizontal className="w-7 h-7 text-zinc-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">Send Tokens</h2>
            <p className="text-zinc-500 text-sm max-w-xs mx-auto">
              Save an API key from the Wallets page to send NEAR and Intents tokens.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${mode === "deposit" ? "bg-blue-500/10" : "bg-emerald-500/10"}`}>
          {mode === "deposit" ? (
            <ArrowDownLeft className="w-4 h-4 text-blue-400" />
          ) : (
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
          )}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {mode === "deposit" ? "Deposit" : "Send"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {mode === "deposit"
              ? "Move tokens from base chain into Intents"
              : "Transfer from your custody wallet"}
          </p>
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex bg-muted rounded-lg p-1 mb-4">
        <button
          type="button"
          onClick={() => setMode("withdraw")}
          className={`flex-1 h-9 text-sm font-medium rounded-md transition-all ${
            mode === "withdraw"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Withdraw
        </button>
        <button
          type="button"
          onClick={() => setMode("deposit")}
          className={`flex-1 h-9 text-sm font-medium rounded-md transition-all ${
            mode === "deposit"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Deposit
        </button>
      </div>

      {/* Wallet selector */}
      {savedWallets.length > 0 && (
        <Card className="mb-4">
          <CardContent className="p-3">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
              From Wallet
            </Label>
            <div className="relative">
              <select
                value={selectedIndex}
                onChange={(e) => setSelectedIndex(Number(e.target.value))}
                className="w-full h-11 appearance-none bg-zinc-50 border border-zinc-200 rounded-lg px-3 pr-10 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
              >
                {savedWallets.map((w, i) => {
                  const display = w.label || shortAddr(w.pubkey.replace(/^ed25519:/, ""));
                  const locked = w.passkeyProtected;
                  return (
                    <option key={w.pubkey} value={i} disabled={locked}>
                      {locked ? "🔒 " : ""}{display}{locked ? " — tap to unlock" : ""}
                    </option>
                  );
                })}
              </select>
              <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
            {savedWallets[selectedIndex]?.passkeyProtected && (
              <button
                type="button"
                onClick={async () => {
                  const pk = savedWallets[selectedIndex].pubkey;
                  await handleUnlock(pk);
                }}
                disabled={unlockingPubkey !== null}
                className="flex items-center gap-1.5 mt-2 text-xs text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50"
              >
                {unlockingPubkey ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Fingerprint className="w-3.5 h-3.5" />
                )}
                {unlockingPubkey ? "Unlocking..." : "Unlock with passkey"}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {balanceError && (
        <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
          <p className="text-sm text-red-400">{balanceError}</p>
        </div>
      )}

      {/* Deposit info banner */}
      {mode === "deposit" && (
        <div className="mb-4 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-3">
          <p className="text-sm text-blue-400">
            Deposits move tokens from your NEAR account into Intents for swaps and cross-chain transfers.
          </p>
        </div>
      )}

      {/* Transaction status banner */}
      {txStatus === "pending" && (
        <div className="mb-4 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          <p className="text-sm text-blue-400">
            {mode === "deposit" ? "Deposit submitted, confirming..." : "Transaction submitted, confirming..."}
          </p>
        </div>
      )}
      {txStatus === "success" && (
        <div className="mb-4 bg-emerald-500/10 border-l-4 border-emerald-500 rounded-r-lg p-3">
          <p className="text-sm text-emerald-400">
            {mode === "deposit" ? "Deposited" : "Sent"} {selected?.symbol} successfully! {txHash && (
              <span className="font-mono text-xs opacity-70 block mt-1 break-all">{txHash}</span>
            )}
          </p>
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Token selector */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Token
            </Label>
            {isTokenLoading ? (
              <Skeleton className="h-11 w-full rounded-lg" />
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full h-11 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
              >
                {selected ? (
                  <>
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: tokenColor(selected.symbol) }}
                    >
                      {selected.symbol.charAt(0)}
                    </div>
                    <span className="flex-1 text-left">{selected.symbol}</span>
                    <span className="text-xs text-muted-foreground">{displayBalance}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Select token</span>
                )}
              </button>
            )}
          </div>

          {/* Recipient (withdraw mode only) */}
          {mode === "withdraw" && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Recipient
              </Label>
              <Input
                type="text"
                placeholder={
                  selectedToken === "NEAR"
                    ? "NEAR account or hex address"
                    : "Destination address"
                }
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="h-11 text-sm"
              />
            </div>
          )}

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Amount
              </Label>
              <span className="text-xs text-muted-foreground">
                Balance: {displayBalance} {selected?.symbol}
              </span>
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
                  setEstimatedFee(null);
                }}
                className="h-11 text-sm pr-16"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleMax();
                }}
                onMouseDown={(e) => e.preventDefault()}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-xs font-semibold text-emerald-500 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-emerald-500/10 transition-colors cursor-pointer"
              >
                Max
              </button>
            </div>
            {amountExceedsBalance && (
              <p className="text-xs text-red-400 mt-1">
                Amount exceeds available balance ({displayBalance} {selected?.symbol})
              </p>
            )}
            {selectedToken === "NEAR" && !amountExceedsBalance && (
              <p className="text-[10px] text-muted-foreground mt-1">
                ~0.00045 NEAR reserved for gas
              </p>
            )}
          </div>

          {/* Fee estimation */}
          {estimatedFee && (
            <div className="flex items-center justify-between text-xs text-muted-foreground py-1">
              <span>Estimated fee</span>
              <span className="font-mono">{estimatedFee}</span>
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
            onClick={handleSubmit}
            disabled={!isValid || sending}
            className="w-full h-12 text-sm font-semibold"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {mode === "deposit" ? "Depositing..." : "Sending..."}
              </>
            ) : (
              <>
                {mode === "deposit" ? (
                  <ArrowDownLeft className="w-4 h-4 mr-2" />
                ) : (
                  <SendHorizontal className="w-4 h-4 mr-2" />
                )}
                {mode === "deposit" ? `Deposit ${selected?.symbol}` : `Send ${selected?.symbol}`}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Token picker modal */}
      <TokenPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        tokens={tokenOptions as TokenOption[]}
        selectedId={selectedToken}
        onSelect={(id) => {
          setSelectedToken(id);
          setAmount("");
          setEstimatedFee(null);
        }}
        title={mode === "deposit" ? "Select token to deposit" : "Select token to send"}
      />
    </div>
  );
}
