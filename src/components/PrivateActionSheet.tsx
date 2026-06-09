import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  shieldToConfidential,
  unshieldFromConfidential,
  confidentialTransfer,
  confidentialSwap,
  confidentialWithdraw,
  type SupportedToken,
} from "@/lib/api";

export type PrivateSheetMode = "shield" | "unshield" | "send" | "swap" | "withdraw" | null;

/** Convert raw balance string → human-readable number string with decimals. */
export function formatAmount(raw: string, decimals: number): string {
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

/** Convert human-readable amount (e.g. "0.5") to atomic units string */
export function toAtomic(human: string, decimals: number): string {
  const cleaned = human.replace(/,/g, "").trim();
  if (!cleaned || cleaned === ".") return "0";
  const num = Number(cleaned);
  if (!isFinite(num) || num <= 0) return "0";
  const [intPart, fracPart = ""] = cleaned.split(".");
  const fracPadded = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const atomic = (intPart || "0") + fracPadded;
  return BigInt(atomic).toString();
}

export function PrivateActionSheet({
  mode,
  apiKey,
  onClose,
  tokenCatalog,
  publicTokens,
  shieldedItems,
  onSubmit,
}: {
  mode: PrivateSheetMode;
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

  const titles: Record<Exclude<PrivateSheetMode, null>, string> = {
    shield: "Shield to private",
    unshield: "Unshield to public",
    send: "Private transfer",
    swap: "Private swap",
    withdraw: "Private withdraw",
  };

  const sourceList = mode === "shield" ? publicTokens : shieldedItems;

  const sourceTokens = sourceList
    .map((t) => {
      const tok = tokenCatalog.find((c) => c.defuse_asset_id === t.assetId);
      return { ...t, symbol: tok?.symbol ?? t.assetId.split(":").pop(), decimals: tok?.decimals ?? 18 };
    })
    .filter((t) => t.amount !== "0");

  const emptyMessage =
    mode === "shield"
      ? "No public balance to shield. Deposit tokens to your wallet first."
      : mode === "unshield"
      ? "No shielded balance."
      : mode === "send"
      ? "No shielded balance to send."
      : mode === "swap"
      ? "No shielded balance to swap."
      : mode === "withdraw"
      ? "No shielded balance to withdraw."
      : null;

  const targetTokenChoices = mode === "swap"
    ? tokenCatalog.filter((t) => t.defuse_asset_id !== assetId)
    : [];

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const humanAmt = amount.trim();
      if (!humanAmt || Number(humanAmt) <= 0) {
        throw new Error("Enter an amount greater than 0");
      }
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
          {sourceTokens.length === 0 && emptyMessage ? (
            <>
              <p className="text-sm text-muted-foreground text-center py-6">{emptyMessage}</p>
              <button
                onClick={onClose}
                className="w-full bg-muted hover:bg-muted text-white font-medium rounded-lg py-2.5 transition-colors"
              >
                Close
              </button>
            </>
          ) : (
            <>
          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Token</span>
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select token...</option>
              {sourceTokens.map((t) => (
                <option key={t.assetId} value={t.assetId}>
                  {t.symbol} ({formatAmount(t.amount, t.decimals)})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">
              Amount{assetId && sourceTokens.length > 0 ? ` (${sourceTokens.find((t) => t.assetId === assetId)?.symbol ?? ""})` : ""}
            </span>
            <input
              type="text"
              value={amount}
              onChange={(e) => {
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

          {mode === "swap" && (
            <label className="block">
              <span className="text-xs text-muted-foreground mb-1 block">Output token</span>
              <select
                value={outputAssetId}
                onChange={(e) => setOutputAssetId(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select output...</option>
                {targetTokenChoices.map((t) => (
                  <option key={t.defuse_asset_id} value={t.defuse_asset_id}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </label>
          )}

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
                  placeholder={mode === "withdraw" ? "0x... or bc1... or <near>.near" : "<account>.near"}
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
            {submitting ? "Submitting..." : "Confirm"}
          </button>

          <p className="text-[10px] text-muted-foreground text-center">
            Action runs asynchronously. Poll the request_id on Activity to see when it settles.
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
