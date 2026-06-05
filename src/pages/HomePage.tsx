import { useState, Suspense, lazy } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Loader2 } from "lucide-react";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { formatTokenBalance } from "@/hooks/useWalletBalances";
import { getAllWalletKeys, saveWalletKey } from "@/lib/wallet-keys";
import { getCoordinatorApiUrl } from "@/lib/api";
import ActionRing from "@/components/ActionRing";
import TokenIcon from "@/components/TokenIcon";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import ReceiveSheet from "@/components/ReceiveSheet";
import EmptyStateHero from "@/components/EmptyStateHero";

const WalletSendPage = lazy(() => import("./WalletSendPage"));
const WalletSwapPage = lazy(() => import("./WalletSwapPage"));

/** Format yoctoNEAR to human-readable NEAR with up to 4 decimals */
function formatNear(yocto: string): string {
  const value = BigInt(yocto);
  if (value === 0n) return "0";
  const divisor = 10n ** 24n;
  const intPart = value / divisor;
  const fracPart = value % divisor;
  if (fracPart === 0n) return intPart.toLocaleString();
  // Up to 4 decimal places
  let fracStr = fracPart.toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${intPart.toLocaleString()}.${fracStr}` : intPart.toLocaleString();
}

function formatMarketPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  // Tiny prices: show 6 significant-ish digits
  return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { accountId, isConnected, requestLogin, googleUser, switchToWallet } = useNearWallet();

  // Derive apiKey, label, and effective balance address from stored wallet keys
  const { apiKey, walletLabel, walletAddress } = (() => {
    const keys = getAllWalletKeys();
    // Try exact match first: ed25519:{accountId}
    if (accountId) {
      const match = Object.entries(keys).find(([pk]) => pk === `ed25519:${accountId}`);
      if (match) {
        const entry = match[1];
        const label = entry.label
          || (entry.googleEmail ? entry.googleEmail.split('@')[0] : null)
          || (accountId.length > 20 ? `${accountId.slice(0, 10)}...${accountId.slice(-4)}` : accountId);
        return { apiKey: entry.apiKey || null, walletLabel: label, walletAddress: accountId };
      }
    }
    // Fallback: use first stored wallet key (agent wallet address ≠ NEAR account)
    const firstEntry = Object.entries(keys)[0];
    if (firstEntry) {
      const [pk, entry] = firstEntry;
      const addr = pk.replace(/^ed25519:/, "");
      const label = entry.label
        || (entry.googleEmail ? entry.googleEmail.split('@')[0] : null)
        || (addr.length > 20 ? `${addr.slice(0, 10)}...${addr.slice(-4)}` : addr);
      return { apiKey: entry.apiKey || null, walletLabel: label, walletAddress: addr };
    }
    return { apiKey: null, walletLabel: null, walletAddress: accountId };
  })();

  // Use walletAddress (agent wallet) for balance lookups, not the NEAR extension account
  const { near, tokens, baseChainTokens, allTokens, loading, baseChainLoading, refetch } = useWalletBalances(apiKey, walletAddress);

  const [sendOpen, setSendOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  // Inline API key import (shown when logged in but no wallet yet)
  const [importKeyValue, setImportKeyValue] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImportKey = async () => {
    const key = importKeyValue.trim();
    if (!key) return;
    setImporting(true);
    setImportError(null);
    try {
      const coordinatorUrl = getCoordinatorApiUrl();
      const resp = await fetch(`${coordinatorUrl}/wallet/v1/address?chain=near`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        setImportError(`Invalid API key: HTTP ${resp.status}`);
        return;
      }
      const data = await resp.json();
      saveWalletKey(`ed25519:${data.address}`, key, "imported");
      setImportKeyValue("");
      // Switch to the imported wallet so balances show immediately
      switchToWallet(data.address, key);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Failed to import key");
    } finally {
      setImporting(false);
    }
  };

  // Compute total USD value
  const totalUsd = (() => {
    if (!near) return 0;
    // Find NEAR price from allTokens (look for wNEAR or NEAR)
    const nearToken = allTokens.find(
      (t) => t.symbol === "wNEAR" || t.defuse_asset_id.includes("wrap.near"),
    );
    const nearPrice = nearToken?.price ?? 0;
    const nearValue = Number(near.balance) / 1e24 * nearPrice;

    const tokenValue = tokens.reduce((sum, t) => {
      if (!t.price) return sum;
      return sum + Number(t.balance) / 10 ** t.decimals * t.price;
    }, 0);

    const baseChainValue = baseChainTokens.reduce((sum, t) => {
      if (!t.price) return sum;
      return sum + Number(t.balance) / 10 ** t.decimals * t.price;
    }, 0);

    return nearValue + tokenValue + baseChainValue;
  })();

  const formattedBalance =
    totalUsd > 0 ? `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : near ? `${formatNear(near.balance)} NEAR`
    : null;

  // First-visit explainer — only when not logged in.
  // Logged-in users see the normal dashboard (original behavior).
  if (!isConnected) {
    return <EmptyStateHero />;
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-24">
      {/* Total balance */}
      <div className="flex flex-col items-center pt-6 pb-6">
        {loading && !near ? (
          <>
            <SkeletonBlock className="h-9 w-36 mb-1" />
            <SkeletonBlock className="h-3 w-20" />
          </>
        ) : (
          <>
            <span className="text-3xl font-bold tabular-nums tracking-tight">
              {formattedBalance ?? "$0.00"}
            </span>
            {!apiKey && isConnected && (
              <span className="text-xs text-muted-foreground mt-1">
                Connect an API key to see full balances
              </span>
            )}
          </>
        )}
      </div>

      {/* Action ring */}
      <ActionRing
        onSend={() => setSendOpen(true)}
        onSwap={() => setSwapOpen(true)}
        onReceive={() => setReceiveOpen(true)}
      />

      {/* Token list */}
      <div className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">Tokens</span>
          <button
            onClick={() => refetch()}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground"
            aria-label="Refresh balances"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {!apiKey ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="text-sm text-muted-foreground mb-3">
              Import an API key to see balances
            </span>
            <div className="w-full max-w-xs space-y-2">
              <input
                type="text"
                placeholder="wk_..."
                value={importKeyValue}
                onChange={(e) => { setImportKeyValue(e.target.value); setImportError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleImportKey(); }}
                disabled={importing}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />
              {importError && (
                <p className="text-xs text-red-500">{importError}</p>
              )}
              <button
                onClick={handleImportKey}
                disabled={importing || !importKeyValue.trim()}
                className="w-full text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        ) : loading && tokens.length === 0 && baseChainTokens.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <SkeletonBlock className="h-9 w-9 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <SkeletonBlock className="h-4 w-16" />
                  <SkeletonBlock className="h-2.5 w-28" />
                </div>
                <div className="text-right space-y-1.5">
                  <SkeletonBlock className="h-4 w-20 ml-auto" />
                  <SkeletonBlock className="h-2.5 w-14 ml-auto" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card/50 divide-y divide-border/30 px-3">
            {/* NEAR row */}
            {near && (
              <div className="flex items-center gap-3 py-3 cursor-pointer active:bg-muted/50 px-1 rounded-lg transition-colors">
                <TokenIcon symbol="NEAR" size={36} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">NEAR</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-mono">{formatNear(near.balance)}</div>
                  {(() => {
                    const nearPrice = allTokens.find(
                      (t) => t.symbol === "wNEAR" || t.defuse_asset_id.includes("wrap.near"),
                    )?.price;
                    if (!nearPrice) return null;
                    const usd = Number(near.balance) / 1e24 * nearPrice;
                    return (
                      <div className="text-[10px] text-muted-foreground">
                        ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Intents section */}
            {tokens.length > 0 && (
              <>
                <div className="flex items-center gap-2 mt-3 mb-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">In Intents</span>
                  <span className="text-[10px] bg-lime-500/15 text-lime-500 px-1.5 py-0.5 rounded-full font-medium">
                    cross-chain
                  </span>
                </div>
                {[...tokens]
                  .sort((a, b) => a.symbol.localeCompare(b.symbol))
                  .map((token) => (
                    <div
                      key={token.defuse_asset_id}
                      className="flex items-center gap-3 py-3 cursor-pointer active:bg-muted/50 px-1 rounded-lg transition-colors"
                    >
                      <TokenIcon symbol={token.symbol} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{token.symbol}</div>
                        {token.price != null && (
                          <div className="text-[10px] text-muted-foreground">
                            ${formatMarketPrice(token.price)}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono">
                          {formatTokenBalance(token.balance, token.decimals)}
                        </div>
                        {token.price != null && (
                          <div className="text-[10px] text-muted-foreground">
                            ${(Number(token.balance) / 10 ** token.decimals * token.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </>
            )}

            {/* Base chain section */}
            {baseChainTokens.length > 0 && (
              <>
                <div className="flex items-center gap-2 mt-4 mb-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">On Base Chain</span>
                  <span className="text-[10px] bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded-full font-medium">
                    NEAR
                  </span>
                </div>
                {baseChainLoading && baseChainTokens.length === 0 ? (
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-2.5">
                        <SkeletonBlock className="h-9 w-9 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <SkeletonBlock className="h-4 w-16" />
                          <SkeletonBlock className="h-2.5 w-28" />
                        </div>
                        <div className="text-right space-y-1.5">
                          <SkeletonBlock className="h-4 w-20 ml-auto" />
                          <SkeletonBlock className="h-2.5 w-14 ml-auto" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  [...baseChainTokens]
                    .sort((a, b) => a.symbol.localeCompare(b.symbol))
                    .map((token) => (
                      <div
                        key={token.defuse_asset_id}
                        className="flex items-center gap-3 py-3 cursor-pointer active:bg-muted/50 px-1 rounded-lg transition-colors"
                      >
                        <TokenIcon symbol={token.symbol} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{token.symbol}</div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                            {token.defuse_asset_id.replace("nep141:", "")}
                          </div>
                          {token.price != null && (
                            <div className="text-[10px] text-lime-500/80">
                              ${formatMarketPrice(token.price)}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-mono">
                            {formatTokenBalance(token.balance, token.decimals)}
                          </div>
                          {token.price != null && (
                            <div className="text-[10px] text-muted-foreground">
                              ${(Number(token.balance) / 10 ** token.decimals * token.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </>
            )}

            {near && tokens.length === 0 && baseChainTokens.length === 0 && !loading && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No additional tokens found
              </div>
            )}
          </div>
        )}
      </div>

      {/* Send modal */}
      <BottomSheetModal open={sendOpen} onClose={() => setSendOpen(false)} title="Send">
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>}>
          <WalletSendPage />
        </Suspense>
      </BottomSheetModal>

      {/* Swap modal */}
      <BottomSheetModal open={swapOpen} onClose={() => setSwapOpen(false)} title="Swap">
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>}>
          <WalletSwapPage />
        </Suspense>
      </BottomSheetModal>

      {/* Receive modal */}
      <BottomSheetModal open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive">
        {walletAddress ? <ReceiveSheet address={walletAddress} /> : (
          <p className="text-center text-sm text-muted-foreground py-8">No wallet connected</p>
        )}
      </BottomSheetModal>
    </div>
  );
}
