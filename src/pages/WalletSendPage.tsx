import { useState, useMemo, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getCoordinatorApiUrl } from "@/lib/api";
import { getAllWalletKeys } from "@/lib/wallet-keys";
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
  ArrowDownLeft,
  Wallet,
  Info,
} from "lucide-react";
import { TokenPickerModal, type TokenOption } from "@/components/TokenPickerModal";
import TokenIcon from "@/components/TokenIcon";

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
const NEAR_GAS_RESERVE = "450000000000000000000";

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

  // Check for ?key= query param
  const urlKey = searchParams.get("key");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const initialIndexSet = useMemo(() => {
    if (!urlKey) return -1;
    return savedWallets.findIndex((w) => w.apiKey === urlKey);
  }, [urlKey, savedWallets]);

  useEffect(() => {
    if (initialIndexSet >= 0) setSelectedIndex(initialIndexSet);
  }, [initialIndexSet]);

  const directApiKey = urlKey && initialIndexSet < 0 ? urlKey : null;
  const activeApiKey = savedWallets[selectedIndex]?.apiKey ?? directApiKey ?? null;
  const activePubkey = savedWallets[selectedIndex]?.pubkey ?? null;
  const balanceAccountId = activePubkey?.replace(/^ed25519:/, "") ?? null;

  // Balances — Intents balances for tokens, NEAR from RPC
  const { near, tokens, allTokens, loading, error: balanceError, refetch } = useWalletBalances(
    activeApiKey,
    balanceAccountId,
  );

  // Form state
  const [selectedToken, setSelectedToken] = useState<string>("NEAR");

  // Build unified token list from hook (Intents + Rhea base chain tokens)
  const tokenOptions = useMemo(() => {
    const options: TokenOption[] = [
      { id: "NEAR", symbol: "NEAR", decimals: 24, balance: near?.balance ?? "0" },
    ];
    for (const t of tokens) {
      options.push({
        id: t.defuse_asset_id,
        symbol: t.symbol,
        decimals: t.decimals,
        balance: t.balance,
        price: t.price,
      });
    }
    return options;
  }, [near, tokens]);

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null);

  // Reset form when wallet changes
  useEffect(() => {
    setSelectedToken("NEAR");
    setAmount("");
    setRecipient("");
    setError(null);
    setTxStatus("idle");
    setTxHash(null);
    setStep(null);
  }, [activeApiKey]);

  const selected = tokenOptions.find((t) => t.id === selectedToken);

  // Check if selected token is only on base chain (not deposited into Intents yet)
  const isBaseChain = useMemo(() => {
    if (!selected || selected.id === "NEAR") return false;
    const found = tokens.find((t) => t.defuse_asset_id === selected.id);
    return found?.baseChainOnly === true;
  }, [selected, tokens]);

  // Format balance for display
  const displayBalance = useMemo(() => {
    if (!selected) return "0";
    if (selected.id === "NEAR") return formatYoctoToNear(selected.balance);
    return formatTokenBalance(selected.balance, selected.decimals);
  }, [selected]);

  // Max amount (NEAR subtracts gas reserve)
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

  const handleMax = () => setAmount(maxAmount);

  // Detect if recipient looks like a NEAR account
  const isNearRecipient = useMemo(() => {
    const r = recipient.trim();
    return r.endsWith(".near") || r.endsWith(".testnet");
  }, [recipient]);

  // Get chain info for a token
  const getTokenChain = (tokenId: string) => {
    if (tokenId === "NEAR") return "near";
    const found = allTokens.find((t) => t.defuse_asset_id === tokenId);
    return found?.chains[0] ?? "near";
  };

  const handleSubmit = async () => {
    if (!activeApiKey || !amount.trim() || !selected || !recipient.trim()) return;

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

      if (selected.id === "NEAR") {
        // ── Simple NEAR transfer ──
        setStep("Sending NEAR...");
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
        // ── Token send: auto-deposit if needed, then withdraw ──
        const assetId = selected.id;
        const contractName = assetId.startsWith("nep141:")
          ? assetId.slice("nep141:".length)
          : assetId;
        const chain = getTokenChain(assetId) as "near" | "ethereum" | "bitcoin" | "solana" | string;
        const minimalUnits = toMinimalUnits(amount, selected.decimals);

        // If recipient is on NEAR and we're on NEAR, we might need storage
        const needsDeposit = true; // Always check / auto-deposit for tokens

        // Step 1: Dry-run the withdraw to validate
        setStep("Preparing...");
        const withdrawBody = {
          to: recipient.trim(),
          amount: minimalUnits,
          token: contractName,
          chain: chain,
        };

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

        // Step 2: Auto-deposit if Intents balance is insufficient
        if (!dryRun.ok || dryResult.would_succeed === false) {
          const msg = dryResult.message || dryResult.error || "";
          // If it's an insufficient balance error, try depositing first
          if (msg.toLowerCase().includes("balance") || msg.toLowerCase().includes("insufficient") || dryRun.status === 400) {
            setStep("Funding transfer...");
            const depositResp = await fetch(`${coordinatorUrl}/wallet/v1/intents/deposit`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${activeApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ token: contractName, amount: minimalUnits }),
            });
            if (!depositResp.ok) {
              const errBody = await depositResp.text().catch(() => "");
              throw new Error(errBody || `Failed to fund transfer: HTTP ${depositResp.status}`);
            }
            const depositResult = await depositResp.json().catch(() => null);
            if (depositResult?.status === "failed") {
              throw new Error("Funding transaction failed on-chain");
            }
            // Small delay for settlement
            await new Promise((r) => setTimeout(r, 500));
          } else {
            throw new Error(msg || "Transfer check failed");
          }
        }

        // Step 3: Execute the withdraw
        setStep("Sending...");
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
          throw new Error(errBody || `Send failed: HTTP ${resp.status}`);
        }
        result = await resp.json().catch(() => null);
      }

      // Success
      setTxHash((result?.transaction_hash || result?.tx_hash) as string ?? null);
      setTxStatus("success");
      toast(`Sent ${amount} ${selected.symbol} successfully`);
      setAmount("");
      setRecipient("");
      refetch();
      setTimeout(() => setTxStatus("idle"), 3000);
    } catch (err) {
      setTxStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setTxStatus("idle"), 3000);
    } finally {
      setSending(false);
      setStep(null);
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
        return yoctoAmount > BigInt(selected.balance);
      } else {
        const minimalAmount = BigInt(toMinimalUnits(amount, selected.decimals));
        return minimalAmount > BigInt(selected.balance);
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
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <SendHorizontal className="w-7 h-7 text-zinc-400" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Send Tokens</h2>
            <p className="text-zinc-500 text-sm max-w-xs mx-auto">
              Save an API key from the Wallets page to send NEAR and tokens.
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
        <div className="w-8 h-8 rounded-lg bg-lime-500/10 flex items-center justify-center">
          <SendHorizontal className="w-4 h-4 text-lime-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Send</h1>
          <p className="text-xs text-muted-foreground">
            Transfer tokens to any address
          </p>
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
                className="w-full h-11 appearance-none bg-background border border-input rounded-lg px-3 pr-10 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-lime-500/30 focus:border-lime-500 transition-colors"
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
      )}

      {balanceError && (
        <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3">
          <p className="text-sm text-red-400">{balanceError}</p>
        </div>
      )}

      {/* Transaction status banner */}
      {txStatus === "pending" && (
        <div className="mb-4 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          <p className="text-sm text-blue-400">{step || "Processing..."}</p>
        </div>
      )}
      {txStatus === "success" && (
        <div className="mb-4 bg-lime-500/10 border-l-4 border-lime-500 rounded-r-lg p-3">
          <p className="text-sm text-lime-400">
            Sent {selected?.symbol} successfully! {txHash && (
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
            {loading ? (
              <Skeleton className="h-11 w-full rounded-lg" />
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full h-11 flex items-center gap-2 bg-background border border-input rounded-lg px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-lime-500/30 focus:border-lime-500 transition-colors"
              >
                {selected ? (
                  <>
                    <TokenIcon symbol={selected.symbol} size={24} />
                    <span className="flex-1 text-left">{selected.symbol}</span>
                    <span className="text-xs text-muted-foreground">{displayBalance}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Select token</span>
                )}
              </button>
            )}
          </div>

          {/* Info: base chain token will auto-deposit */}
          {isBaseChain && (
            <div className="bg-amber-500/10 border-l-4 border-amber-500 rounded-r-lg p-3 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-400">
                This token is on your base chain. It will be automatically deposited into Intents before sending.
              </p>
            </div>
          )}

          {/* Recipient */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Recipient
            </Label>
            <Input
              type="text"
              placeholder={
                selectedToken === "NEAR"
                  ? "NEAR account (e.g. bob.near)"
                  : "Wallet address"
              }
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                setError(null);
              }}
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
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
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
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-xs font-semibold text-lime-500 hover:text-lime-400 px-2 py-1 rounded-md hover:bg-lime-500/10 transition-colors cursor-pointer"
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
            onClick={handleSubmit}
            disabled={!isValid || sending}
            className="w-full h-12 text-sm font-semibold"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {step || "Sending..."}
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

      {/* Token picker modal */}
      <TokenPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        tokens={tokenOptions}
        selectedId={selectedToken}
        onSelect={(id) => {
          setSelectedToken(id);
          setAmount("");
        }}
        title="Select token to send"
      />
    </div>
  );
}
