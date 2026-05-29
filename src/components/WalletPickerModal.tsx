import { useState, useEffect, useRef } from 'react'
import { X, Check } from 'lucide-react'
import { getAllWalletKeys } from '@/lib/wallet-keys'
import { fetchSupportedTokens, fetchIntentsBalancesBatch, fetchRheaTokenPrices, fetchBaseChainBalances } from '@/lib/api'
import { fetchNearAccountBalance } from '@/lib/near-rpc'

interface WalletEntry {
  pubkey: string
  nearAccountId: string
  label: string | null
  googleEmail: string | null
  isActive: boolean
  apiKey: string | null
}

interface WalletPickerModalProps {
  open: boolean
  onClose: () => void
  activeAccountId: string | null
  onSelect: (nearAccountId: string, apiKey: string) => void
}

export default function WalletPickerModal({ open, onClose, activeAccountId, onSelect }: WalletPickerModalProps) {
  const [balances, setBalances] = useState<Record<string, string>>({})
  const fetchedRef = useRef(false)

  const wallets: WalletEntry[] = (() => {
    const keys = getAllWalletKeys()
    return Object.entries(keys).map(([pk, entry]) => ({
      pubkey: pk,
      nearAccountId: pk.replace('ed25519:', ''),
      label: entry.label || (entry.googleEmail ? entry.googleEmail.split('@')[0] : null),
      googleEmail: entry.googleEmail || null,
      isActive: pk.replace('ed25519:', '') === activeAccountId,
      apiKey: entry.apiKey || null,
    }))
  })()

  // Fetch total balances async — show wallets immediately, fill in as they arrive
  useEffect(() => {
    if (!open || wallets.length === 0) return
    fetchedRef.current = false
    setBalances({})

    let cancelled = false

    const fetchAll = async () => {
      try {
        // 1. Get token catalog (shared across all wallets)
        const allTokens = await fetchSupportedTokens()
        if (cancelled) return
        const tokenIds = allTokens.map((t) => t.defuse_asset_id)
        const nearToken = allTokens.find(
          (t) => t.symbol === "wNEAR" || t.defuse_asset_id.includes("wrap.near"),
        )
        const nearPrice = nearToken?.price ?? 0

        // 2. Fetch balances for each wallet in parallel
        const results = await Promise.all(
          wallets.map(async (w): Promise<[string, string]> => {
            try {
              // NEAR balance
              const yocto = await fetchNearAccountBalance(w.nearAccountId)
              const nearBal = Number(yocto) / 1e24
              let totalUsd = nearBal * nearPrice

              // Token balances (intents batch)
              if (w.apiKey && tokenIds.length > 0) {
                try {
                  const tokenBals = await fetchIntentsBalancesBatch(w.nearAccountId, tokenIds)
                  for (let i = 0; i < allTokens.length; i++) {
                    const bal = Number(tokenBals[i] ?? "0")
                    if (bal > 0 && allTokens[i].price) {
                      totalUsd += (bal / 10 ** allTokens[i].decimals) * allTokens[i].price
                    }
                  }
                } catch { /* token balances failed, show NEAR only */ }
              }

              // Rhea base chain tokens — cover tokens ChainDefuser misses
              try {
                const rheaPrices = await fetchRheaTokenPrices()
                if (!rheaPrices || cancelled) throw new Error()
                const defuseIds = new Set(allTokens.map((t) => {
                  const id = t.defuse_asset_id
                  return id.startsWith("nep141:") ? id.slice(7) : id
                }))
                const rheaCandidates = Object.entries(rheaPrices)
                  .filter(([cid, info]) => !defuseIds.has(cid) && info.price >= 0.001 && info.symbol)
                  .slice(0, 60)

                if (rheaCandidates.length === 0) throw new Error()

                // Single backend call — no CORS issues
                const balances = await fetchBaseChainBalances(w.nearAccountId, rheaCandidates.map(([cid]) => cid))

                for (const [contractId, info] of rheaCandidates) {
                  const bal = balances[contractId]
                  if (bal && bal !== "0" && info.price) {
                    totalUsd += (Number(bal) / 10 ** info.decimal) * info.price
                  }
                }
              } catch { /* Rhea scan failed, skip */ }

              const formatted = totalUsd >= 1
                ? `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : totalUsd > 0
                  ? `$${totalUsd.toFixed(2)}`
                  : "$0.00"

              return [w.nearAccountId, formatted]
            } catch {
              return [w.nearAccountId, "—"]
            }
          }),
        )

        if (cancelled) return
        const map: Record<string, string> = {}
        for (const [id, val] of results) map[id] = val
        setBalances(map)
      } catch { /* catalog fetch failed */ }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-2xl shadow-xl w-full max-w-sm max-h-[70vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Switch Wallet</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-muted transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        {/* Wallet list */}
        <div className="flex-1 overflow-y-auto p-2">
          {wallets.map((w) => (
            <button
              key={w.pubkey}
              onClick={() => {
                if (!w.isActive && w.apiKey) {
                  onSelect(w.nearAccountId, w.apiKey)
                  onClose()
                }
              }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                w.isActive ? 'bg-lime-500/10' : 'hover:bg-muted active:bg-muted'
              }`}
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-foreground shrink-0">
                {(w.label || w.nearAccountId).charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {w.label || w.nearAccountId}
                  </span>
                  {w.isActive && <Check size={14} className="text-lime-500 shrink-0" />}
                </div>
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {w.googleEmail || w.nearAccountId}
                </div>
              </div>

              {/* Balance */}
              <div className="text-right shrink-0">
                {balances[w.nearAccountId] ? (
                  <span className="text-sm font-medium tabular-nums">
                    {balances[w.nearAccountId]}
                  </span>
                ) : (
                  <div className="w-14 h-4 bg-muted rounded animate-pulse" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
