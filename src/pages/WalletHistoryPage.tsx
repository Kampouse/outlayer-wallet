import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useNearWallet } from '@/contexts/NearWalletContext';
import { getCoordinatorApiUrl, fetchSupportedTokens } from '@/lib/api';
import type { SupportedToken } from '@/lib/api';
import { getAllWalletKeys } from '@/lib/wallet-keys';
import {
  decodeTransactionDetails,
  formatRelativeTime,
} from '@/lib/transaction-decode';
import type { DecodedTransaction } from '@/lib/transaction-decode';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  Settings,
  Snowflake,
  Sun,
  CheckCircle2,
  HelpCircle,
  Activity,
  Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEvent {
  type: string;
  request_id: string | null;
  status: string | null;
  details: Record<string, unknown>;
  at: string;
}

interface WalletRequest {
  id: string;
  type: string;
  status: string;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface WalletKeyInfo {
  pubkey: string;
  apiKey: string;
  label?: string;
}

interface WalletEntry {
  pubkey: string;
  apiKey: string;
  walletId: string;
  label: string;
  events: AuditEvent[];
  requests: WalletRequest[];
  error?: string;
  hasMore: boolean;
  page: number;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  pending:
    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  success:
    'bg-lime-500/10 text-lime-400 border-lime-500/20',
  completed:
    'bg-lime-500/10 text-lime-400 border-lime-500/20',
  failed:
    'bg-red-500/10 text-red-400 border-red-500/20',
  rejected:
    'bg-red-500/10 text-red-400 border-red-500/20',
  approved:
    'bg-lime-500/10 text-lime-400 border-lime-500/20',
  auto_executed:
    'bg-lime-500/10 text-lime-400 border-lime-500/20',
};

function getStatusStyle(status: string | null): string {
  if (!status) return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
  return (
    STATUS_STYLES[status.toLowerCase()] ||
    'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  );
}

function formatStatusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Icon component
// ---------------------------------------------------------------------------

function TransactionIcon({
  icon,
  className,
}: {
  icon: DecodedTransaction['icon'];
  className?: string;
}) {
  const cls = className ?? 'h-4 w-4';
  switch (icon) {
    case 'withdraw':
    case 'withdraw_pending':
      return <ArrowUpRight className={cls} />;
    case 'deposit':
      return <ArrowDownLeft className={cls} />;
    case 'policy':
      return <Settings className={cls} />;
    case 'freeze':
      return <Snowflake className={cls} />;
    case 'unfreeze':
      return <Sun className={cls} />;
    case 'approval':
      return <CheckCircle2 className={cls} />;
    default:
      return <HelpCircle className={cls} />;
  }
}

const ICON_BG: Record<DecodedTransaction['icon'], string> = {
  withdraw: 'bg-orange-500/10 text-orange-400',
  withdraw_pending: 'bg-yellow-500/10 text-yellow-400',
  deposit: 'bg-lime-500/10 text-lime-400',
  policy: 'bg-purple-500/10 text-purple-400',
  freeze: 'bg-blue-500/10 text-blue-400',
  unfreeze: 'bg-teal-500/10 text-teal-400',
  approval: 'bg-blue-500/10 text-blue-400',
  unknown: 'bg-zinc-500/10 text-zinc-400',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WalletHistoryPage() {
  const { network } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);
  const searchParams = new URLSearchParams(useLocation().search);

  const [selectedWallet, setSelectedWallet] = useState<string>('all');
  const [manualKeyInput, setManualKeyInput] = useState('');
  const [manualKeys, setManualKeys] = useState<WalletKeyInfo[]>([]);

  // --- Saved keys ---
  const savedKeys = useQuery({
    queryKey: ['saved-wallet-keys'],
    queryFn: () => {
      const saved = getAllWalletKeys();
      const keyMap = new Map<string, WalletKeyInfo>();

      const keyFromUrl = searchParams.get('key');
      if (keyFromUrl) {
        keyMap.set(keyFromUrl, {
          pubkey: '_url',
          apiKey: keyFromUrl,
          label: 'URL key',
        });
      }

      for (const [pubkey, stored] of Object.entries(saved)) {
        if (!keyMap.has(stored.apiKey)) {
          keyMap.set(stored.apiKey, {
            pubkey,
            apiKey: stored.apiKey,
            label: stored.label,
          });
        }
      }

      return Array.from(keyMap.values());
    },
    staleTime: 60_000,
  });

  const allKeys = [...(savedKeys.data || []), ...manualKeys];

  // Auto-select single wallet from URL key
  useEffect(() => {
    const keyFromUrl = searchParams.get('key');
    if (keyFromUrl && allKeys.length === 1) {
      setSelectedWallet('_single');
    }
  }, [searchParams, allKeys.length]);

  // --- Token catalog (public, no auth) ---
  const tokenCatalogQuery = useQuery({
    queryKey: ['supported-tokens'],
    queryFn: fetchSupportedTokens,
    staleTime: 5 * 60_000,
  });
  const tokenCatalog: SupportedToken[] = tokenCatalogQuery.data ?? [];

  // --- Fetch audit + requests for each key ---
  const walletQueries = useQuery({
    queryKey: [
      'history-wallets',
      allKeys.map((k) => k.apiKey).join(','),
      coordinatorUrl,
    ],
    queryFn: async () => {
      if (allKeys.length === 0) return [];

      const results = await Promise.allSettled(
        allKeys.map(async (entry) => {
          const addrResp = await fetch(
            `${coordinatorUrl}/wallet/v1/address?chain=near`,
            {
              headers: { Authorization: `Bearer ${entry.apiKey}` },
            },
          );
          if (!addrResp.ok) {
            const err = await addrResp
              .json()
              .catch(() => ({ error: addrResp.statusText }));
            throw new Error(
              err.error || err.message || `API error: ${addrResp.status}`,
            );
          }
          const addrData = await addrResp.json();
          const walletId = addrData.wallet_id as string;

          // Fetch audit events
          const auditParams = new URLSearchParams({
            limit: PAGE_SIZE.toString(),
            offset: '0',
          });
          const auditResp = await fetch(
            `${coordinatorUrl}/wallet/v1/audit?${auditParams}`,
            {
              headers: { Authorization: `Bearer ${entry.apiKey}` },
            },
          );
          if (!auditResp.ok) {
            const err = await auditResp
              .json()
              .catch(() => ({ error: auditResp.statusText }));
            throw new Error(
              err.error || err.message || `API error: ${auditResp.status}`,
            );
          }
          const auditData = await auditResp.json();
          const events: AuditEvent[] = auditData.events || [];

          // Fetch requests
          let requests: WalletRequest[] = [];
          try {
            const reqResp = await fetch(
              `${coordinatorUrl}/wallet/v1/requests?limit=${PAGE_SIZE}&offset=0`,
              {
                headers: { Authorization: `Bearer ${entry.apiKey}` },
              },
            );
            if (reqResp.ok) {
              const reqData = await reqResp.json();
              requests = reqData.requests || [];
            }
          } catch {
            // Requests endpoint may not exist — ignore
          }

          return {
            pubkey: entry.pubkey,
            apiKey: entry.apiKey,
            walletId,
            label: entry.label || walletId.substring(0, 16),
            events,
            requests,
            hasMore: events.length === PAGE_SIZE,
            page: 0,
          } as WalletEntry;
        }),
      );

      return results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          ...allKeys[i],
          walletId: '',
          label:
            allKeys[i].label || allKeys[i].pubkey.substring(0, 16),
          events: [],
          requests: [],
          error: (r.reason as Error).message,
          hasMore: false,
          page: 0,
        } as WalletEntry;
      });
    },
    enabled: allKeys.length > 0,
    staleTime: 2 * 60_000,
  });

  // --- Pagination ---
  const [pageFetch, setPageFetch] = useState<{
    walletId: string;
    page: number;
    apiKey: string;
    pubkey: string;
    label: string;
  } | null>(null);

  const pageQuery = useQuery({
    queryKey: [
      'history-page',
      pageFetch?.walletId,
      pageFetch?.page,
      pageFetch?.apiKey,
    ],
    queryFn: async () => {
      if (!pageFetch) return null;

      const auditParams = new URLSearchParams({
        limit: PAGE_SIZE.toString(),
        offset: (pageFetch.page * PAGE_SIZE).toString(),
      });
      const auditResp = await fetch(
        `${coordinatorUrl}/wallet/v1/audit?${auditParams}`,
        {
          headers: { Authorization: `Bearer ${pageFetch.apiKey}` },
        },
      );
      const auditData = await auditResp.json();

      return {
        pubkey: pageFetch.pubkey,
        apiKey: pageFetch.apiKey,
        walletId: pageFetch.walletId,
        label: pageFetch.label,
        events: auditData.events || [],
        requests: [],
        hasMore: (auditData.events || []).length === PAGE_SIZE,
        page: pageFetch.page,
      } as WalletEntry;
    },
    enabled: !!pageFetch,
  });

  const wallets = walletQueries.data || [];
  const finalWallets = wallets.map((w) => {
    if (pageQuery.data && pageQuery.data.walletId === w.walletId) {
      return pageQuery.data;
    }
    return w;
  });

  const loadPage = (walletId: string, newPage: number) => {
    const wallet = finalWallets.find((w) => w.walletId === walletId);
    if (!wallet) return;
    setPageFetch({
      walletId,
      page: newPage,
      apiKey: wallet.apiKey,
      pubkey: wallet.pubkey,
      label: wallet.label,
    });
  };

  const handleManualKeySubmit = () => {
    const key = manualKeyInput.trim();
    if (!key) return;
    setManualKeyInput('');
    if (allKeys.some((k) => k.apiKey === key)) return;
    setManualKeys((prev) => [
      ...prev,
      { pubkey: '_manual', apiKey: key, label: 'Manual key' },
    ]);
  };

  const isPageLoading = pageQuery.isFetching && !pageQuery.isPending;
  const multiWallet = finalWallets.length > 1;
  const visibleWallets =
    selectedWallet === 'all' || selectedWallet === '_single'
      ? finalWallets
      : finalWallets.filter((w) => w.walletId === selectedWallet);

  const singleWallet =
    visibleWallets.length === 1 ? visibleWallets[0] : null;

  const errors = visibleWallets
    .filter((w) => w.error)
    .map((w) => `${w.label}: ${w.error}`);
  const noKeys =
    allKeys.length === 0 &&
    !savedKeys.isLoading &&
    !manualKeys.length;

  // --- Build unified timeline ---
  interface TimelineItem {
    id: string;
    type: 'audit' | 'request';
    eventType: string;
    status: string | null;
    at: string;
    walletId: string;
    walletLabel: string;
    decoded: DecodedTransaction;
    rawDetails: Record<string, unknown>;
  }

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];

    for (const w of visibleWallets) {
      // Audit events
      for (const evt of w.events) {
        items.push({
          id: `audit-${w.walletId}-${evt.at}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'audit',
          eventType: evt.type,
          status: evt.status,
          at: evt.at,
          walletId: w.walletId,
          walletLabel: w.label,
          decoded: decodeTransactionDetails(
            evt.details,
            evt.type,
            tokenCatalog,
          ),
          rawDetails: evt.details,
        });
      }
      // Requests (deduplicate against audit events by request_id)
      const auditRequestIds = new Set(
        w.events
          .map((e) => e.request_id)
          .filter(Boolean) as string[],
      );
      for (const req of w.requests) {
        if (auditRequestIds.has(req.id)) continue;
        const evtType =
          req.type === 'withdraw'
            ? 'withdraw'
            : req.type === 'deposit'
              ? 'deposit'
              : req.type;
        items.push({
          id: `req-${req.id}`,
          type: 'request',
          eventType: evtType,
          status: req.status,
          at: req.created_at,
          walletId: w.walletId,
          walletLabel: w.label,
          decoded: decodeTransactionDetails(
            req.details,
            evtType,
            tokenCatalog,
          ),
          rawDetails: req.details,
        });
      }
    }

    items.sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
    return items;
  }, [visibleWallets, tokenCatalog]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (noKeys) {
    return (
      <div className="max-w-6xl mx-auto px-4 pt-4">
        <Card>
          <CardContent className="p-8">
            <p className="text-zinc-600 mb-4">
              No saved wallet keys found. Enter an API key to view
              activity.
            </p>
            <div className="flex gap-3">
              <Input
                type="text"
                value={manualKeyInput}
                onChange={(e) => setManualKeyInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && handleManualKeySubmit()
                }
                placeholder="wk_..."
                className="flex-1 font-mono text-sm"
              />
              <Button
                onClick={handleManualKeySubmit}
                disabled={!manualKeyInput.trim()}
              >
                Load
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading =
    walletQueries.isPending || walletQueries.isFetching;

  return (
    <div className="max-w-6xl mx-auto px-4 pt-4 pb-24">
      {/* Manual key input */}
      <div className="flex gap-3 mb-4">
        <Input
          type="text"
          value={manualKeyInput}
          onChange={(e) => setManualKeyInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && handleManualKeySubmit()
          }
          placeholder="Add API key..."
          className="flex-1 font-mono text-sm"
        />
        <Button
          onClick={handleManualKeySubmit}
          disabled={!manualKeyInput.trim()}
          variant="outline"
          size="sm"
        >
          Add
        </Button>
      </div>

      {/* Page header */}
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-5 w-5 text-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Activity</h1>
        {tokenCatalog.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {tokenCatalog.length} tokens indexed
          </span>
        )}
      </div>

      {/* Wallet filter tabs */}
      {multiWallet && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setSelectedWallet('all')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              selectedWallet === 'all'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-background text-muted-foreground border-border hover:border-muted-foreground'
            }`}
          >
            All wallets ({finalWallets.length})
          </button>
          {finalWallets.map((w) => (
            <button
              key={w.walletId}
              onClick={() => setSelectedWallet(w.walletId)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors font-mono ${
                selectedWallet === w.walletId
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-background text-muted-foreground border-border hover:border-muted-foreground'
              }`}
            >
              {w.label}
              {w.error && (
                <span className="ml-1 text-red-400">!</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-4">
          {errors.map((e, i) => (
            <p key={i} className="text-sm text-red-400">
              {e}
            </p>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : timeline.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Activity className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
            <p className="text-zinc-500">No activity found.</p>
            <p className="text-xs text-zinc-400 mt-1">
              Transactions will appear here once you send, receive, or
              modify your wallet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block bg-background rounded-lg border border-border overflow-hidden">
            <table className="min-w-full divide-y divide-zinc-200">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Time
                  </th>
                  {multiWallet && selectedWallet === 'all' && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Wallet
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Activity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {timeline.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-zinc-50/50"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-zinc-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(item.at)}
                      </span>
                    </td>
                    {multiWallet && selectedWallet === 'all' && (
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-zinc-400 font-mono">
                        {item.walletLabel}
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center rounded-full p-1.5 ${ICON_BG[item.decoded.icon]}`}
                        >
                          <TransactionIcon
                            icon={item.decoded.icon}
                            className="h-3.5 w-3.5"
                          />
                        </span>
                        <span className="text-sm text-foreground">
                          {item.decoded.description}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground font-medium">
                      {item.decoded.amount !== null
                        ? `${item.decoded.amount} ${item.decoded.symbol ?? ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${getStatusStyle(item.status)}`}
                      >
                        {formatStatusLabel(item.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {timeline.map((item) => (
              <Card
                key={item.id}
                className="border-zinc-200"
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <span
                      className={`inline-flex items-center justify-center rounded-full p-2 shrink-0 ${ICON_BG[item.decoded.icon]}`}
                    >
                      <TransactionIcon
                        icon={item.decoded.icon}
                        className="h-4 w-4"
                      />
                    </span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {item.decoded.description}
                        </span>
                        {item.status && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] shrink-0 ${getStatusStyle(item.status)}`}
                          >
                            {formatStatusLabel(item.status)}
                          </Badge>
                        )}
                      </div>

                      {item.decoded.amount !== null && (
                        <p className="text-sm font-semibold text-foreground mt-0.5">
                          {item.decoded.amount}{' '}
                          {item.decoded.symbol ?? ''}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-zinc-400 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(item.at)}
                        </span>
                        {multiWallet &&
                          selectedWallet === 'all' && (
                            <span className="text-xs text-zinc-400 font-mono truncate">
                              {item.walletLabel}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {singleWallet && (
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                onClick={() =>
                  loadPage(
                    singleWallet.walletId,
                    Math.max(0, singleWallet.page - 1),
                  )
                }
                disabled={singleWallet.page === 0 || isPageLoading}
              >
                Previous
              </Button>
              <span className="text-sm text-zinc-500">
                Page {singleWallet.page + 1}
              </span>
              <Button
                variant="outline"
                onClick={() =>
                  loadPage(
                    singleWallet.walletId,
                    singleWallet.page + 1,
                  )
                }
                disabled={!singleWallet.hasMore || isPageLoading}
              >
                {isPageLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : singleWallet.hasMore ? (
                  'Load More'
                ) : (
                  'No More'
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {/* Mobile skeletons */}
      <div className="sm:hidden space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="border-zinc-200">
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop skeletons */}
      <div className="hidden sm:block bg-background rounded-lg border border-border overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 w-32" />
              <th className="px-4 py-3" />
              <th className="px-4 py-3 w-32" />
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
