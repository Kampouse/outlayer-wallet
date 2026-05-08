import { useState, useMemo, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getCoordinatorApiUrl } from "@/lib/api";
import { getAllWalletKeys, type StoredKey } from "@/lib/wallet-keys";
import { useWalletBalances, formatTokenBalance } from "@/hooks/useWalletBalances";
import { useToast } from "@/components/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SendHorizontal, Loader2, ChevronDown, ArrowUpRight, Wallet } from "lucide-react";

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

/** Gas reserve for NEAR transfers (0.00045 NEAR) */
const NEAR_GAS_RESERVE = "45000000000000000000000";

export default function WalletSendPage() {
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const { toast } = useToast();
  const coordinatorUrl = getCoordinatorApiUrl();

  // Load all saved wallets from localStorage
  const savedWallets = useMemo(() => {
    const keys = getAllWalletKeys();
    return Object.entries(keys).map(([pubkey, stored]) => ({
      pubkey,
      label: stored.label,
      apiKey: stored.apiKey,
    }));
  }, []);

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

  // Fetch balances for the selected wallet (uses pubkey, same as manage page)
  const { near, tokens, loading, error: balanceError, refetch } = useWalletBalances(
    activeApiKey,
    balanceAccountId,
  );

  // Form state
  const [selectedToken, setSelectedToken] = useState<string>("NEAR");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when wallet changes
  useEffect(() => {
    setSelectedToken("NEAR");
    setAmount("");
    setRecipient("");
    setError(null);
  }, [activeApiKey]);

  // Build token options: NEAR + all tokens with non-zero balance
  const tokenOptions = useMemo(() => {
    const options = [{ id: "NEAR", symbol: "NEAR", decimals: 24, balance: near?.balance ?? "0", chain: "near" as const }];
    for (const t of tokens) {
      options.push({
        id: t.defuse_asset_id,
        symbol: t.symbol,
        decimals: t.decimals,
        balance: t.balance,
        chain: t.chains[0] ?? "near",
      });
    }
    return options;
  }, [near, tokens]);

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
    if (selected.id === "NEAR") {
      const balance = BigInt(selected.balance);
      const reserve = BigInt(NEAR_GAS_RESERVE);
      if (balance <= reserve) return "0";
      const available = balance - reserve;
      return formatYoctoToNear(available.toString());
    }
    return formatTokenBalance(selected.balance, selected.decimals);
  }, [selected]);

  const handleMax = () => {
    setAmount(maxAmount);
  };

  const handleSend = async () => {
    if (!activeApiKey || !recipient.trim() || !amount.trim() || !selected) return;

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError("Amount must be a positive number");
      return;
    }

    setSending(true);
    setError(null);

    try {
      let resp: Response;

      if (selected.id === "NEAR") {
        // Transfer NEAR
        const yoctoAmount = nearToYocto(amount);
        resp = await fetch(`${coordinatorUrl}/wallet/v1/transfer`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ receiver_id: recipient.trim(), amount: yoctoAmount }),
        });
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
        // Multisig required is informational — the actual withdraw handles it
        // (returns pending_approval status for signers to approve)

        // Execute the actual withdraw
        resp = await fetch(`${coordinatorUrl}/wallet/v1/intents/withdraw`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(withdrawBody),
        });
      }

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(errBody || `Transfer failed: HTTP ${resp.status}`);
      }

      // Success
      toast(`Sent ${amount} ${selected.symbol} successfully`);
      setAmount("");
      setRecipient("");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    recipient.trim().length > 0 &&
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
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          <ArrowUpRight className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Send</h1>
          <p className="text-xs text-muted-foreground">Transfer from your custody wallet</p>
        </div>
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
                  return (
                    <option key={w.apiKey} value={i}>
                      {display}
                    </option>
                  );
                })}
              </select>
              <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </CardContent>
        </Card>
      )}

      {balanceError && (
        <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
          <p className="text-sm text-red-400">{balanceError}</p>
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Token selector */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Token
            </Label>
            {loading ? (
              <Skeleton className="h-11 w-full rounded-lg" />
            ) : (
              <div className="relative">
                <select
                  value={selectedToken}
                  onChange={(e) => {
                    setSelectedToken(e.target.value);
                    setAmount("");
                  }}
                  className="w-full h-11 appearance-none bg-zinc-50 border border-zinc-200 rounded-lg px-3 pr-10 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                >
                  {tokenOptions.map((t) => {
                    const bal =
                      t.id === "NEAR"
                        ? formatYoctoToNear(t.balance)
                        : formatTokenBalance(t.balance, t.decimals);
                    return (
                      <option key={t.id} value={t.id}>
                        {t.symbol} — {bal}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
            )}
          </div>

          {/* Recipient */}
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
                onChange={(e) => setAmount(e.target.value)}
                className="h-11 text-sm pr-16"
              />
              <button
                type="button"
                onClick={handleMax}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-emerald-500 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-emerald-500/10 transition-colors"
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

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={handleSend}
            disabled={!isValid || sending}
            className="w-full h-12 text-sm font-semibold"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <SendHorizontal className="w-4 h-4 mr-2" />
                Send {selected?.symbol}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
