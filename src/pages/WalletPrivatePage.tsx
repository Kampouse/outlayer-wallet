import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Shield, RefreshCw, ArrowDownToLine, ArrowUpFromLine,
  Send, ArrowLeftRight, ArrowRightFromLine, Info, AlertTriangle, Loader2,
} from "lucide-react";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getAllWalletKeys } from "@/lib/wallet-keys";
import {
  fetchConfidentialBalance,
  fetchIntentsBalancesBatch,
  shieldToConfidential,
  unshieldFromConfidential,
  confidentialTransfer,
  confidentialSwap,
  confidentialWithdraw,
  fetchSupportedTokens,
  type SupportedToken,
  type ConfidentialBalance,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the first stored wallet key + label for the current NEAR/Google user. */
function useActiveWalletKey(): { apiKey: string | null; label: string | null; address: string | null } {
  const { accountId } = useNearWallet();
  return useMemo(() => {
    const keys = getAllWalletKeys();
    if (accountId) {
      const match = Object.entries(keys).find(([pk]) => pk === `ed25519:${accountId}`);
      if (match) {
        const [, entry] = match;
        return { apiKey: entry.apiKey, label: entry.label || null, address: accountId };
      }
    }
    const first = Object.entries(keys)[0];
    if (first) {
      const [pk, entry] = first;
      return {
        apiKey: entry.apiKey,
        label: entry.label || null,
        address: pk.replace(/^ed25519:/, ""),
      };
    }
    return { apiKey: null, label: null, address: accountId || null };
  }, [accountId]);
}

/** Convert raw balance string → human-readable number string with decimals. */
function formatAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  try {
    const value = BigInt(raw);
    if (value === 0n) return "0";
    const divisor = 10n ** BigInt(decimals);
    const intPart = value / divisor;
    const fracPart = value % divisor;
    if (fracPart === 0n) return intPart.toLocaleString();
    const fracStr = fracPart.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
    return fracStr ? `${intPart.toLocaleString()}.${fracStr}` : intPart.toLocaleString();
  } catch {
    return "0";
  }
}

/** Flatten the balance response into a list of { assetId, amount } pairs. */
function flattenBalances(data: ConfidentialBalance | undefined): Array<{ assetId: string; amount: string }> {
  if (!data) return [];
  if (data.items && data.items.length) {
    return data.items.map((i) => ({ assetId: i.asset_id, amount: i.amount }));
  }
  if (data.balances) {
    // Handle array of {token, balance} objects (actual API format)
    if (Array.isArray(data.balances)) {
      return (data.balances as Array<Record<string, unknown>>)
        .map((b) => ({
          assetId: String(b.token ?? b.asset_id ?? b.assetId ?? ""),
          amount: String(b.balance ?? b.amount ?? "0"),
        }))
        .filter((b) => b.assetId);
    }
    // Handle Record<string, string>
    return Object.entries(data.balances).map(([assetId, amount]) => ({
      assetId,
      amount: typeof amount === "string" ? amount : String((amount as Record<string, unknown>)?.balance ?? "0"),
    }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidentialBalanceCard({
  items,
  tokenCatalog,
  loading,
  onRefresh,
}: {
  items: Array<{ assetId: string; amount: string; symbol?: string; decimals?: number; price?: number }>;
  tokenCatalog: SupportedToken[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const totalUsd = items.reduce((sum, t) => {
    if (!t.price) return sum;
    return sum + Number(t.amount) / 10 ** (t.decimals ?? 18) * t.price;
  }, 0);

  return (
    <div className="bg-card/50 border border-border rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="relative w-9 h-9 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-purple-500/15" />
            <Shield size={16} className="text-purple-400 relative z-10" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Shielded balance</h2>
            <p className="text-xs text-muted-foreground">private shard · intents.far</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex flex-col items-start mb-4">
        {loading && items.length === 0 ? (
          <>
            <div className="h-9 w-32 bg-muted/40 rounded-md animate-pulse mb-1" />
            <div className="h-3 w-20 bg-muted/30 rounded animate-pulse" />
          </>
        ) : (
          <>
            <span className="text-3xl font-bold tabular-nums tracking-tight">
              {totalUsd > 0
                ? `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "$0.00"}
            </span>
            <span className="text-xs text-muted-foreground mt-1">
              {items.length === 0 ? "No shielded assets" : `${items.length} asset${items.length === 1 ? "" : "s"}`}
            </span>
          </>
        )}
      </div>

      {items.length > 0 && (
        <div className="space-y-2 mt-2">
          {items.map((t) => {
            const decimals = t.decimals ?? 18;
            const amount = formatAmount(t.amount, decimals);
            const usd = t.price
              ? Number(t.amount) / 10 ** decimals * t.price
              : null;
            return (
              <div key={t.assetId} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center text-[10px] font-bold text-purple-300 shrink-0">
                    {(t.symbol || "?").slice(0, 3)}
                  </div>
                  <span className="text-sm truncate">{t.symbol || t.assetId.slice(0, 12)}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm tabular-nums">{amount}</div>
                  {usd !== null && usd > 0 && (
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card/40 border border-border/50 hover:bg-card/60 hover:border-border disabled:opacity-40 disabled:cursor-not-allowed transition-all"
    >
      <div className="relative w-10 h-10 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-purple-500/15" />
        <Icon size={18} className="text-purple-300 relative z-10" />
      </div>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function PrivacyDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-amber-500/[0.04] border border-amber-500/20 rounded-xl px-4 py-3 mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left"
      >
        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
        <span className="text-xs font-semibold text-amber-200">How private is this?</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {open ? "hide" : "show"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-amber-100/80">
          <p>
            Confidential balances are <strong>real on-chain state on a private shard</strong>{" "}
            (<code className="bg-amber-500/10 px-1 rounded">intents.far</code>) with no public RPC.
            Chain-graph bots cannot read them.
          </p>
          <p>
            <strong>Shield/unshield link your wallet on the public chain.</strong> Entry and exit
            reveal your NEAR wallet. Cross-chain deposit/withdraw keep your NEAR wallet off the
            public chain, only the external-chain sender/receiver is visible on that chain.
          </p>
          <p>
            <strong>Not hidden from:</strong> the Defuse/1Click solver layer (sees plaintext
            intents), the partner mapping, the shard operator, auditors, and law enforcement with
            a warrant.
          </p>
          <p>
            <strong>For unlinkability:</strong> fund via cross-chain deposit, exit via cross-chain
            withdraw. One confidential identity per wallet, multi-op unlinkability is not
            achievable today.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action sheet (simple shared form for shield / unshield)
// ---------------------------------------------------------------------------

type SheetMode = "shield" | "unshield" | "send" | "swap" | "withdraw" | null;

function ActionSheet({
  mode,
  apiKey,
  onClose,
  tokenCatalog,
  publicTokens,
  shieldedItems,
  onSubmit,
}: {
  mode: SheetMode;
  apiKey: string;
  onClose: () => void;
  tokenCatalog: SupportedToken[];
  publicTokens: Array<{ assetId: string; amount: string }>;
  shieldedItems: Array<{ assetId: string; amount: string }>;
  onSubmit: (msg: string) => void;
}) {
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [outputAssetId, setOutputAssetId] = useState("");
  const [chain, setChain] = useState("near");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAssetId("");
    setAmount("");
    setRecipient("");
    setOutputAssetId("");
    setError(null);
  }, [mode]);

  if (!mode) return null;

  const titles: Record<Exclude<SheetMode, null>, string> = {
    shield: "Shield to private",
    unshield: "Unshield to public",
    send: "Private transfer",
    swap: "Private swap",
    withdraw: "Private withdraw",
  };

  // For shield: choose from public intents balance.
  // For unshield/send/swap/withdraw: choose from shielded balance.
  const sourceList = mode === "shield"
    ? publicTokens
    : shieldedItems;

  const sourceTokens = sourceList
    .map((t) => {
      const tok = tokenCatalog.find((c) => c.defuse_asset_id === t.assetId);
      return { ...t, symbol: tok?.symbol ?? t.assetId.split(":").pop(), decimals: tok?.decimals ?? 18 };
    })
    .filter((t) => t.amount !== "0");

  const targetTokenChoices = mode === "swap"
    ? tokenCatalog.filter((t) => t.defuse_asset_id !== assetId)
    : [];

  // Convert human-readable amount (e.g. "0.5") to atomic units string
  const toAtomic = (human: string, decimals: number): string => {
    const cleaned = human.replace(/,/g, "").trim();
    if (!cleaned || cleaned === ".") return "0";
    const num = Number(cleaned);
    if (!isFinite(num) || num <= 0) return "0";
    // Use string math to avoid floating precision loss
    const [intPart, fracPart = ""] = cleaned.split(".");
    const fracPadded = fracPart.padEnd(decimals, "0").slice(0, decimals);
    const atomic = (intPart || "0") + fracPadded;
    return BigInt(atomic).toString();
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const humanAmt = amount.trim();
      if (!humanAmt || Number(humanAmt) <= 0) {
        throw new Error("Enter an amount greater than 0");
      }
      // Resolve decimals for the selected token
      const tok = sourceTokens.find((t) => t.assetId === assetId);
      const decimals = tok?.decimals ?? 18;
      const amt = toAtomic(humanAmt, decimals);
      if (amt === "0" || BigInt(amt) <= 0n) {
        throw new Error("Amount too small after rounding");
      }
      let res;
      switch (mode) {
        case "shield":
          if (!assetId) throw new Error("Pick a token");
          res = await shieldToConfidential(apiKey, assetId, amt);
          onSubmit(`Shielded. request_id: ${res.request_id}`);
          break;
        case "unshield": {
          if (!assetId) throw new Error("Pick a token");
          res = await unshieldFromConfidential(apiKey, assetId, amt);
          onSubmit(`Unshielded. request_id: ${res.request_id}`);
          break;
        }
        case "send": {
          if (!assetId) throw new Error("Pick a token");
          if (!recipient.trim()) throw new Error("Enter a recipient address");
          res = await confidentialTransfer(apiKey, assetId, amt, recipient.trim());
          onSubmit(`Sent. request_id: ${res.request_id}`);
          break;
        }
        case "swap": {
          if (!assetId || !outputAssetId) throw new Error("Pick input and output tokens");
          res = await confidentialSwap(apiKey, assetId, outputAssetId, amt);
          onSubmit(`Swap submitted. request_id: ${res.request_id}`);
          break;
        }
        case "withdraw": {
          if (!assetId) throw new Error("Pick a token");
          if (!recipient.trim()) throw new Error("Enter destination address");
          res = await confidentialWithdraw(apiKey, assetId, amt, recipient.trim(), chain);
          onSubmit(`Withdrawal submitted. request_id: ${res.request_id}`);
          break;
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 pb-8 sm:pb-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">{titles[mode]}</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          {/* Token picker */}
          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Token</span>
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select token…</option>
              {sourceTokens.map((t) => (
                <option key={t.assetId} value={t.assetId}>
                  {t.symbol} ({formatAmount(t.amount, t.decimals)})
                </option>
              ))}
            </select>
          </label>

          {/* Amount */}
          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">
              Amount{assetId && sourceTokens.length > 0 ? ` (${sourceTokens.find((t) => t.assetId === assetId)?.symbol ?? ""})` : ""}
            </span>
            <input
              type="text"
              value={amount}
              onChange={(e) => {
                // Allow digits and a single dot
                let v = e.target.value.replace(/[^0-9.]/g, "");
                const firstDot = v.indexOf(".");
                if (firstDot !== -1) {
                  v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
                }
                setAmount(v);
              }}
              placeholder="0.0"
              inputMode="decimal"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm tabular-nums"
            />
            {assetId && sourceTokens.length > 0 && (() => {
              const tok = sourceTokens.find((t) => t.assetId === assetId);
              if (!tok || tok.amount === "0") return null;
              const humanMax = formatAmount(tok.amount, tok.decimals);
              const setMaxAtomic = () => {
                // Convert the raw balance to a clean human number string
                const decimals = tok.decimals ?? 18;
                const raw = BigInt(tok.amount);
                const divisor = 10n ** BigInt(decimals);
                const intPart = raw / divisor;
                const frac = raw % divisor;
                let fracStr = frac.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
                setAmount(fracStr ? `${intPart}.${fracStr}` : intPart.toString());
              };
              return (
                <button
                  type="button"
                  onClick={setMaxAtomic}
                  className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
                >
                  Max: {humanMax}
                </button>
              );
            })()}
          </label>

          {/* Swap output token */}
          {mode === "swap" && (
            <label className="block">
              <span className="text-xs text-muted-foreground mb-1 block">Output token</span>
              <select
                value={outputAssetId}
                onChange={(e) => setOutputAssetId(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select output…</option>
                {targetTokenChoices.map((t) => (
                  <option key={t.defuse_asset_id} value={t.defuse_asset_id}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Recipient (send / withdraw) */}
          {(mode === "send" || mode === "withdraw") && (
            <>
              <label className="block">
                <span className="text-xs text-muted-foreground mb-1 block">
                  {mode === "withdraw" ? "Destination address" : "Recipient wallet address"}
                </span>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={mode === "withdraw" ? "0x… or bc1… or <near>.near" : "<account>.near"}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono"
                />
              </label>
              {mode === "withdraw" && (
                <label className="block">
                  <span className="text-xs text-muted-foreground mb-1 block">Destination chain</span>
                  <select
                    value={chain}
                    onChange={(e) => setChain(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="near">NEAR</option>
                    <option value="eth">Ethereum</option>
                    <option value="sol">Solana</option>
                    <option value="btc">Bitcoin</option>
                    <option value="base">Base</option>
                    <option value="arb">Arbitrum</option>
                  </select>
                </label>
              )}
            </>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !amount}
            className="w-full bg-purple-500 hover:bg-purple-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition-colors flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? "Submitting…" : "Confirm"}
          </button>

          <p className="text-[10px] text-muted-foreground text-center">
            Action runs asynchronously. Poll the request_id on Activity to see when it settles.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function WalletPrivatePage() {
  const { network } = useNearWallet();
  const { apiKey, label, address } = useActiveWalletKey();
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Token catalog (public)
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

  // Public intents balance (so we know what's available to shield)
  // Reuse the same pattern as the public wallet: fetch supported tokens + mt_batch_balance_of.
  const publicBalancesQ = useQuery({
    queryKey: ["public-intents-balance", address, network],
    queryFn: async () => {
      if (!address) return [];
      const ids = tokenCatalog.map((t) => t.defuse_asset_id);
      if (ids.length === 0) return [];
      const balances = await fetchIntentsBalancesBatch(address, ids);
      return ids.map((id, i) => ({ assetId: id, amount: balances[i] ?? "0" }));
    },
    enabled: !!address && tokenCatalog.length > 0 && network === "mainnet",
    staleTime: 30_000,
  });

  // Decorate shielded items with catalog metadata
  const shieldedItems = useMemo(() => {
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

  const publicTokens = publicBalancesQ.data ?? [];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Testnet gate
  if (network !== "mainnet") {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6 pb-24">
        <div className="flex items-center gap-2 mb-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftRight size={18} />
          </Link>
          <h1 className="text-lg font-semibold">Private</h1>
        </div>
        <div className="bg-yellow-500/[0.04] border border-yellow-500/20 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-yellow-200 mb-1">Mainnet only</h2>
              <p className="text-xs text-yellow-100/70 leading-relaxed">
                Confidential Intents run on a private shard (<code className="bg-yellow-500/10 px-1 rounded">intents.far</code>)
                that only exists on NEAR mainnet. Switch networks to use private balances.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No wallet key
  if (!apiKey) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6 pb-24">
        <div className="flex items-center gap-2 mb-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftRight size={18} />
          </Link>
          <h1 className="text-lg font-semibold">Private</h1>
        </div>
        <div className="bg-card/40 border border-border/50 rounded-2xl p-6">
          <p className="text-sm text-muted-foreground">
            Connect a custody wallet key to view shielded balances. Keys are saved
            locally when you register or import a wallet on the{" "}
            <Link to="/" className="text-purple-300 underline">home screen</Link>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          <ArrowLeftRight size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Private</h1>
          {label && <p className="text-[10px] text-muted-foreground">{label}</p>}
        </div>
        <button
          onClick={() => balQ.refetch()}
          disabled={balQ.isFetching}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className={balQ.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {balQ.error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">
          {balQ.error instanceof Error ? balQ.error.message : "Failed to load shielded balance"}
        </div>
      )}

      {/* Balance card */}
      <ConfidentialBalanceCard
        items={shieldedItems}
        tokenCatalog={tokenCatalog}
        loading={balQ.isPending}
        onRefresh={() => balQ.refetch()}
      />

      {/* Actions */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        <ActionButton icon={ArrowDownToLine} label="Shield" onClick={() => setSheetMode("shield")} />
        <ActionButton icon={ArrowUpFromLine} label="Unshield" onClick={() => setSheetMode("unshield")} />
        <ActionButton icon={Send} label="Send" onClick={() => setSheetMode("send")} />
        <ActionButton icon={ArrowRightFromLine} label="Swap" onClick={() => setSheetMode("swap")} />
        <ActionButton icon={ArrowLeftRight} label="Withdraw" onClick={() => setSheetMode("withdraw")} />
      </div>

      {/* Privacy disclosure */}
      <PrivacyDisclosure />

      {/* Footer info */}
      <div className="text-[10px] text-muted-foreground text-center mt-6 leading-relaxed">
        Shielded funds live on a private NEAR shard at <code className="bg-muted/40 px-1 rounded">intents.far</code>.
        Balances and actions are not visible on public RPC. Read the disclosure above to understand the limits.
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 text-xs shadow-lg z-50 max-w-sm"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}

      {/* Action sheet */}
      <ActionSheet
        mode={sheetMode}
        apiKey={apiKey}
        onClose={() => setSheetMode(null)}
        tokenCatalog={tokenCatalog}
        publicTokens={publicTokens}
        shieldedItems={shieldedItems.map(({ assetId, amount }) => ({ assetId, amount }))}
        onSubmit={(msg) => {
          setToast(msg);
          setTimeout(() => setToast(null), 5000);
          // Refresh balances after a short delay (action is async)
          setTimeout(() => {
            balQ.refetch();
            publicBalancesQ.refetch();
          }, 4000);
        }}
      />
    </div>
  );
}
