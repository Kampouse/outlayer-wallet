import { useState, useEffect, useMemo } from "react";
import { Loader2, ArrowLeftRight } from "lucide-react";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { actionCreators } from "@near-js/transactions";
import { getCoordinatorApiUrl, type SupportedToken } from "@/lib/api";
import { formatAmount, toAtomic } from "@/components/PrivateActionSheet";

export type BridgeDirection = "deposit" | "withdraw";

interface TokenRow {
  assetId: string;        // defuse_asset_id ("nep141:wrap.near" or "near")
  contractId: string | null; // on-chain contract (null for native NEAR)
  symbol: string;
  decimals: number;
  balance: string;        // atomic
}

export function IntentsBridgeSheet({
  direction,
  agentAccountId,
  apiKey,
  userAccountId,
  walletTokens,    // tokens in user's NEAR wallet available to deposit
  intentsTokens,   // tokens already in Intents available to withdraw
  tokenCatalog,
  onClose,
  onDone,
}: {
  direction: BridgeDirection;
  agentAccountId: string;
  apiKey: string;
  userAccountId: string;
  walletTokens: TokenRow[];
  intentsTokens: TokenRow[];
  tokenCatalog: SupportedToken[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { signAndSendTransaction, viewMethod } = useNearWallet();
  const [dir, setDir] = useState<BridgeDirection>(direction);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsStorage, setNeedsStorage] = useState(false);

  useEffect(() => {
    setAssetId("");
    setAmount("");
    setError(null);
    setNeedsStorage(false);
  }, [dir]);

  const sourceTokens = dir === "deposit" ? walletTokens : intentsTokens;

  // Filter non-zero balances + enrich
  const availableTokens = useMemo(
    () => sourceTokens.filter((t) => t.balance !== "0" && BigInt(t.balance) > 0n),
    [sourceTokens],
  );

  const selected = availableTokens.find((t) => t.assetId === assetId) ?? null;

  // Check if intents.near is registered on the token contract (only for FT deposits)
  useEffect(() => {
    if (!selected || dir !== "deposit" || !selected.contractId) {
      setNeedsStorage(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const storage = await viewMethod({
          contractId: selected.contractId!,
          method: "storage_balance_of",
          args: { account_id: "intents.near" },
        });
        if (!cancelled) setNeedsStorage(!storage);
      } catch {
        if (!cancelled) setNeedsStorage(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, dir, viewMethod]);

  const handleSwapDir = () => setDir(dir === "deposit" ? "withdraw" : "deposit");

  const handleMax = () => {
    if (!selected) return;
    setAmount(formatAmount(selected.balance, selected.decimals));
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const humanAmt = amount.trim();
      if (!humanAmt || Number(humanAmt) <= 0) throw new Error("Enter an amount greater than 0");
      if (!selected) throw new Error("Pick a token");

      const amt = toAtomic(humanAmt, selected.decimals);
      if (amt === "0" || BigInt(amt) <= 0n) throw new Error("Amount too small");
      if (BigInt(amt) > BigInt(selected.balance)) throw new Error("Insufficient balance");

      if (dir === "deposit") {
        // On-chain: ft_transfer_call to intents.near
        // msg = agent account ID so intents.near credits the agent
        if (!selected.contractId) {
          // Native NEAR: wrap + deposit via wrap.near contract
          // 1. storage_deposit for user on wrap.near (if needed)
          // 2. near_deposit to wrap
          // 3. ft_transfer_call to intents.near
          const wrapContract = "wrap.near";

          // Check storage on wrap.near for user
          let wrapStorageOk = true;
          try {
            const s = await viewMethod({
              contractId: wrapContract,
              method: "storage_balance_of",
              args: { account_id: userAccountId },
            });
            wrapStorageOk = !!s;
          } catch {}

          const actions = [];
          if (!wrapStorageOk) {
            actions.push(
              actionCreators.functionCall(
                "storage_deposit",
                { account_id: userAccountId, registration_only: true },
                BigInt("30000000000000"),
                BigInt("1250000000000000000000"), // 0.00125 NEAR
              ),
            );
          }

          // Also check intents.near storage on wrap.near
          let intentsStorageOk = true;
          try {
            const s = await viewMethod({
              contractId: wrapContract,
              method: "storage_balance_of",
              args: { account_id: "intents.near" },
            });
            intentsStorageOk = !!s;
          } catch {}
          if (!intentsStorageOk) {
            actions.push(
              actionCreators.functionCall(
                "storage_deposit",
                { account_id: "intents.near", registration_only: true },
                BigInt("30000000000000"),
                BigInt("1250000000000000000000"),
              ),
            );
          }

          // near_deposit to mint wNEAR
          actions.push(
            actionCreators.functionCall(
              "near_deposit",
              {},
              BigInt("30000000000000"),
              BigInt(amt),
            ),
          );

          // ft_transfer_call to intents.near
          actions.push(
            actionCreators.functionCall(
              "ft_transfer_call",
              { receiver_id: "intents.near", amount: amt, msg: agentAccountId },
              BigInt("100000000000000"),
              BigInt("1"),
            ),
          );

          const result = await signAndSendTransaction({
            receiverId: wrapContract,
            actions,
          });
          const hash = result?.transaction_outcome?.id || result?.transaction?.hash;
          onDone(hash ? `Deposited. tx: ${hash.slice(0, 10)}...` : "Deposited");
        } else {
          // FT deposit: storage_deposit (if needed) + ft_transfer_call
          const actions = [];
          if (needsStorage) {
            actions.push(
              actionCreators.functionCall(
                "storage_deposit",
                { account_id: "intents.near", registration_only: true },
                BigInt("30000000000000"),
                BigInt("1250000000000000000000"),
              ),
            );
          }
          actions.push(
            actionCreators.functionCall(
              "ft_transfer_call",
              { receiver_id: "intents.near", amount: amt, msg: agentAccountId },
              BigInt("100000000000000"),
              BigInt("1"),
            ),
          );
          const result = await signAndSendTransaction({
            receiverId: selected.contractId,
            actions,
          });
          const hash = result?.transaction_outcome?.id || result?.transaction?.hash;
          onDone(hash ? `Deposited. tx: ${hash.slice(0, 10)}...` : "Deposited");
        }
      } else {
        // Withdraw: POST to coordinator /wallet/v1/intents/withdraw
        const baseUrl = getCoordinatorApiUrl();
        // For withdraw, "token" is the on-chain contract (not defuse id)
        const tokenContract = selected.contractId || "wrap.near";
        const resp = await fetch(`${baseUrl}/wallet/v1/intents/withdraw`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: userAccountId,
            amount: amt,
            token: tokenContract,
            chain: "near",
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(errBody || `Withdraw failed: HTTP ${resp.status}`);
        }
        const result = await resp.json().catch(() => null);
        const hash = result?.transaction_hash || result?.tx_hash;
        onDone(hash ? `Withdrawn. tx: ${hash.slice(0, 10)}...` : "Withdrawal submitted");
      }

      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes("user reject") && !msg.toLowerCase().includes("cancelled")) {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const dirLabel = dir === "deposit" ? "Wallet → Intents" : "Intents → Wallet";

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
                className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting
                  ? dir === "deposit" ? "Signing..." : "Submitting..."
                  : dir === "deposit" ? "Deposit to Intents" : "Withdraw to Wallet"}
              </button>

              <p className="text-[10px] text-muted-foreground text-center">
                {dir === "deposit"
                  ? "Signs an on-chain transaction from your NEAR wallet."
                  : "Withdrawal runs via the coordinator. Usually settles in a few seconds."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Build a TokenRow[] from useWalletBalances output for the bridge sheet. */
export function buildWalletTokens(
  nearBalance: string | null,
  baseChainTokens: Array<{ defuse_asset_id: string; balance: string; symbol: string; decimals: number }>,
  tokenCatalog: SupportedToken[],
): TokenRow[] {
  const rows: TokenRow[] = [];
  // Native NEAR — synthetic "near" entry
  if (nearBalance && BigInt(nearBalance) > 0n) {
    rows.push({
      assetId: "near",
      contractId: null,
      symbol: "NEAR",
      decimals: 24,
      balance: nearBalance,
    });
  }
  for (const t of baseChainTokens) {
    const contract = t.defuse_asset_id.startsWith("nep141:")
      ? t.defuse_asset_id.slice("nep141:".length)
      : null;
    if (!contract) continue;
    rows.push({
      assetId: t.defuse_asset_id,
      contractId: contract,
      symbol: t.symbol,
      decimals: t.decimals,
      balance: t.balance,
    });
  }
  // Suppress catalog unused warning
  void tokenCatalog;
  return rows;
}

export function buildIntentsTokens(
  intentsTokens: Array<{ defuse_asset_id: string; balance: string; symbol: string; decimals: number }>,
): TokenRow[] {
  return intentsTokens.map((t) => {
    const contract = t.defuse_asset_id.startsWith("nep141:")
      ? t.defuse_asset_id.slice("nep141:".length)
      : null;
    // nep141:wrap.near in Intents represents NEAR — treat as native for withdrawal
    const isNear = t.defuse_asset_id === "nep141:wrap.near";
    return {
      assetId: isNear ? "near" : t.defuse_asset_id,
      contractId: isNear ? null : contract,
      symbol: isNear ? "NEAR" : t.symbol,
      decimals: t.decimals,
      balance: t.balance,
    };
  });
}
