import { useState, useMemo, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Check } from "lucide-react";
import { formatTokenBalance } from "@/hooks/useWalletBalances";
import TokenIcon from "@/components/TokenIcon";

export interface TokenOption {
  id: string;
  symbol: string;
  decimals: number;
  balance: string;
  price?: number;
}

interface TokenPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokens: TokenOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  title?: string;
}

export function TokenPickerModal({
  open,
  onOpenChange,
  tokens,
  selectedId,
  onSelect,
  title = "Select token",
}: TokenPickerModalProps) {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Reset search when modal opens and focus the list for scrollability
  useEffect(() => {
    if (open) {
      setSearch("");
      const t = setTimeout(() => listRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) {
      // Sort: tokens with balance first
      return [...tokens].sort((a, b) => {
        const aBal = a.balance !== "0" && a.balance !== "" ? 1 : 0;
        const bBal = b.balance !== "0" && b.balance !== "" ? 1 : 0;
        if (bBal !== aBal) return bBal - aBal;
        return a.symbol.localeCompare(b.symbol);
      });
    }
    const q = search.toLowerCase();
    return tokens.filter((t) => t.symbol.toLowerCase().includes(q));
  }, [tokens, search]);

  const selected = tokens.find((t) => t.id === selectedId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogContent
        showCloseButton={false}
        className="fixed bottom-0 left-0 right-0 top-auto translate-y-0 translate-x-0 max-w-full rounded-b-none rounded-t-2xl max-h-[80dvh] flex flex-col overflow-hidden p-0 sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-xl sm:rounded-b-xl sm:rounded-t-2xl"
      >
        {/* Drag handle (mobile only) */}
        <div className="flex justify-center pt-3 pb-1 shrink-0 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>

        {/* Title */}
        <div className="px-4 pb-2 shrink-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>

        {/* Search */}
        <div className="px-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-muted/50 border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        {/* Token list */}
        <div
          ref={listRef}
          tabIndex={-1}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-4 outline-none"
        >
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
              No tokens found
            </div>
          ) : (
            filtered.map((t) => {
              const hasBalance = t.balance !== "0" && t.balance !== "";
              const isSelected = t.id === selectedId;

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onSelect(t.id);
                    onOpenChange(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-colors ${
                    isSelected
                      ? "bg-emerald-500/10"
                      : "hover:bg-muted/50 active:bg-muted"
                  }`}
                >
                  {/* Icon */}
                  <TokenIcon symbol={t.symbol} size={36} />

                  {/* Symbol + name */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-semibold text-foreground">
                      {t.symbol}
                    </div>
                  </div>

                  {/* Price + Balance */}
                  <div className="text-right shrink-0">
                    {t.price != null && t.price > 0 && (
                      <div className="text-xs text-muted-foreground mb-0.5">
                        ${t.price >= 1 ? t.price.toFixed(2) : t.price >= 0.01 ? t.price.toFixed(4) : t.price.toFixed(6)}
                      </div>
                    )}
                    {hasBalance ? (
                      <div className="font-medium text-foreground">
                        {formatTokenBalance(t.balance, t.decimals)}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">—</div>
                    )}
                  </div>

                  {/* Check */}
                  {isSelected && (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Selected token bar at bottom */}
        {selected && (
          <div className="border-t border-border px-4 py-3 bg-muted/30 shrink-0">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full flex items-center justify-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400"
            >
              <TokenIcon symbol={selected.symbol} size={24} />
              {selected.symbol}
              <span className="text-muted-foreground">— Close</span>
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
