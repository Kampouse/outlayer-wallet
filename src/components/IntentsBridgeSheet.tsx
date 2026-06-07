import { useState, useEffect, useMemo } from "react";
import { Loader2, ArrowLeftRight, CheckCircle2 } from "lucide-react";
import { getCoordinatorApiUrl, type SupportedToken } from "@/lib/api";
import { formatAmount, toAtomic } from "@/components/PrivateActionSheet";

export type BridgeDirection = "deposit" | "withdraw";

interface TokenRow {
  assetId: string;        // "near" or "nep141:wrap.near" etc
  contractId: string;     // on-chain contract ("wrap.near", or the nep141 contract)
  symbol: string;
  decimals: number;
  balance: string;        // atomic
}

export function IntentsBridgeSheet({
  direction,
  apiKey,
  walletTokens,    // tokens in agent wallet (NEAR + base chain FTs) available to deposit
  intentsTokens,   // tokens already in Intents available to withdraw
  tokenCatalog,
  onClose,
  onDone,
}: {
  direction: BridgeDirection;
  apiKey: string;
  walletTokens: TokenRow[];
  intentsTokens: TokenRow[];
  tokenCatalog: SupportedToken[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [dir, setDir] = useState<BridgeDirection>(direction);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [successHash, setSuccessHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAssetId("");
    setAmount("");
    setError(null);
  }, [dir]);

  const sourceTokens = dir === "deposit" ? walletTokens : intentsTokens;

  const availableTokens = useMemo(
    () => sourceTokens.filter((t) => t.balance !== "0" && BigInt(t.balance) > 0n),
    [sourceTokens],
  );

  const selected = availableTokens.find((t) => t.assetId === assetId) ?? null;

  const handleSwapDir = () => setDir(dir === "deposit" ? "withdraw" : "deposit");

  const handleMax = () => {
    if (!selected) return;
    setAmount(formatAmount(selected.balance, selected.decimals));
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccessHash(null);
    setSubmitting(true);
    setPhase("Preparing...");
    try {
      const humanAmt = amount.trim();
      if (!humanAmt || Number(humanAmt) <= 0) throw new Error("Enter an amount greater than 0");
      if (!selected) throw new Error("Pick a token");

      const amt = toAtomic(humanAmt, selected.decimals);
      if (amt === "0" || BigInt(amt) <= 0n) throw new Error("Amount too small");
      if (BigInt(amt) > BigInt(selected.balance)) throw new Error("Insufficient balance");

      const baseUrl = getCoordinatorApiUrl();

      if (dir === "deposit") {
        if (selected.assetId === "near") {
          setPhase("Registering on wrap.near...");
          const regResp = await fetch(`${baseUrl}/wallet/v1/storage-deposit`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ token: "wrap.near" }),
          });
          if (!regResp.ok) {
            console.warn("[bridge] wrap.near storage-deposit failed", await regResp.text().catch(() => ""));
          }

          setPhase("Wrapping NEAR...");
          const wrapResp = await fetch(`${baseUrl}/wallet/v1/call`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              receiver_id: "wrap.near",
              method_name: "near_deposit",
              args: {},
              deposit: amt,
              gas: "30000000000000",
            }),
          });
          if (!wrapResp.ok) {
            const errBody = await wrapResp.text().catch(() => "");
            throw new Error(errBody || `Wrap failed: HTTP ${wrapResp.status}`);
          }

          // 2. Now deposit wNEAR into Intents
          setPhase("Depositing to Intents...");
          const resp = await fetch(`${baseUrl}/wallet/v1/intents/deposit`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ token: "wrap.near", amount: amt }),
          });
          if (!resp.ok) {
            const errBody = await resp.text().catch(() => "");
            throw new Error(errBody || `Deposit failed: HTTP ${resp.status}`);
          }
          const result = await resp.json().catch(() => null);
          const hash = result?.transaction_hash || result?.tx_hash;

          setSuccessHash(hash ?? null);
          setPhase("Done");
          onDone(hash ? `Depositing. tx: ${hash.slice(0, 10)}...` : "Deposit submitted");
        } else {
          setPhase("Registering storage...");
          const storageResp = await fetch(`${baseUrl}/wallet/v1/storage-deposit`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ token: selected.contractId }),
          });
          if (!storageResp.ok) {
            console.warn("[bridge] storage-deposit preflight failed", await storageResp.text().catch(() => ""));
          }

          setPhase("Depositing to Intents...");
          const resp = await fetch(`${baseUrl}/wallet/v1/intents/deposit`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ token: selected.contractId, amount: amt }),
          });
          if (!resp.ok) {
            const errBody = await resp.text().catch(() => "");
            throw new Error(errBody || `Deposit failed: HTTP ${resp.status}`);
          }
          const result = await resp.json().catch(() => null);
          const hash = result?.transaction_hash || result?.tx_hash;

          setSuccessHash(hash ?? null);
          setPhase("Done");
          onDone(hash ? `Depositing. tx: ${hash.slice(0, 10)}...` : "Deposit submitted");
        }
      } else {
        setPhase("Withdrawing from Intents...");
        const withdrawToken = selected.assetId === "near" ? "near" : selected.contractId;
        const resp = await fetch(`${baseUrl}/wallet/v1/intents/withdraw`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: amt,
            token: withdrawToken,
            chain: "near",
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(errBody || `Withdraw failed: HTTP ${resp.status}`);
        }
        const result = await resp.json().catch(() => null);
        const hash = result?.transaction_hash || result?.tx_hash;

        setSuccessHash(hash ?? null);
        setPhase("Done");
        onDone(hash ? `Withdrawing. tx: ${hash.slice(0, 10)}...` : "Withdrawal submitted");
      }

      // Show success state for 1.2s before closing, so user sees it.
      await new Promise((r) => setTimeout(r, 1200));
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes("user reject") && !msg.toLowerCase().includes("cancelled")) {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
      setPhase(null);
    }
  };

  const dirLabel = dir === "deposit" ? "Wallet → Intents" : "Intents → Wallet";

  // Suppress unused warning
  void tokenCatalog;

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
          <h3 className="text-base font-semibold">Bridge</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
          >
            ×
          </button>
        </div>

        {/* Direction toggle */}
        <button
          onClick={handleSwapDir}
          className="w-full bg-cyan-500/[0.04] border border-cyan-500/15 hover:border-cyan-500/30 rounded-lg px-4 py-3 flex items-center justify-between transition-colors mb-4"
        >
          <div className="text-left">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Direction</div>
            <div className="text-sm font-medium text-cyan-400">{dirLabel}</div>
          </div>
          <ArrowLeftRight size={16} className="text-cyan-400" />
        </button>

        <div className="space-y-3">
          {availableTokens.length === 0 ? (
            <>
              <p className="text-sm text-muted-foreground text-center py-6">
                {dir === "deposit"
                  ? "No tokens in your wallet to deposit."
                  : "No tokens in Intents to withdraw."}
              </p>
              <button
                onClick={onClose}
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-lg py-2.5 transition-colors"
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
                  {availableTokens.map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} ({formatAmount(t.balance, t.decimals)})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-muted-foreground mb-1 block">
                  Amount{selected ? ` (${selected.symbol})` : ""}
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
                {selected && (
                  <button
                    type="button"
                    onClick={handleMax}
                    className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
                  >
                    Max: {formatAmount(selected.balance, selected.decimals)}
                  </button>
                )}
              </label>

              {error && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting || !amount || !selected}
                className={`w-full disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition-colors flex items-center justify-center gap-2 ${
                  phase === "Done"
                    ? "bg-lime-500 hover:bg-lime-400"
                    : "bg-cyan-500 hover:bg-cyan-400"
                }`}
              >
                {submitting && phase !== "Done" && <Loader2 size={14} className="animate-spin" />}
                {phase === "Done" && <CheckCircle2 size={14} />}
                {submitting
                  ? phase === "Done"
                    ? "Success"
                    : phase ?? "Submitting..."
                  : dir === "deposit" ? "Deposit to Intents" : "Withdraw to Wallet"}
              </button>

              {successHash && phase === "Done" && (
                <a
                  href={`https://nearblocks.io/zh-tw/tx/${successHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-[11px] text-lime-400/70 hover:text-lime-400 font-mono truncate"
                >
                  {successHash.slice(0, 20)}...
                </a>
              )}

              <p className="text-[10px] text-muted-foreground text-center">
                Runs via the coordinator. Usually settles in a few seconds.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Build TokenRow[] from wallet-side data (NEAR balance + base chain FTs). */
export function buildWalletTokens(
  nearBalance: string | null,
  baseChainTokens: Array<{ defuse_asset_id: string; balance: string; symbol: string; decimals: number }>,
  tokenCatalog: SupportedToken[],
): TokenRow[] {
  const rows: TokenRow[] = [];
  // Native NEAR — map to wrap.near contract for intents
  if (nearBalance && BigInt(nearBalance) > 0n) {
    rows.push({
      assetId: "near",
      contractId: "wrap.near",
      symbol: "NEAR",
      decimals: 24,
      balance: nearBalance,
    });
  }
  for (const t of baseChainTokens) {
    const contract = t.defuse_asset_id.startsWith("nep141:")
      ? t.defuse_asset_id.slice("nep141:".length)
      : t.defuse_asset_id;
    rows.push({
      assetId: t.defuse_asset_id,
      contractId: contract,
      symbol: t.symbol,
      decimals: t.decimals,
      balance: t.balance,
    });
  }
  void tokenCatalog;
  return rows;
}

/** Build TokenRow[] from Intents-side data. */
export function buildIntentsTokens(
  intentsTokens: Array<{ defuse_asset_id: string; balance: string; symbol: string; decimals: number }>,
): TokenRow[] {
  return intentsTokens.map((t) => {
    const isNear = t.defuse_asset_id === "nep141:wrap.near";
    const contract = isNear
      ? "wrap.near"
      : t.defuse_asset_id.startsWith("nep141:")
      ? t.defuse_asset_id.slice("nep141:".length)
      : t.defuse_asset_id;
    return {
      assetId: isNear ? "near" : t.defuse_asset_id,
      contractId: contract,
      symbol: isNear ? "NEAR" : t.symbol,
      decimals: t.decimals,
      balance: t.balance,
    };
  });
}
