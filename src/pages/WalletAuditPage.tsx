import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useNearWallet } from '@/contexts/NearWalletContext';
import { getCoordinatorApiUrl } from '@/lib/api';
import { getAllWalletKeys } from '@/lib/wallet-keys';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

interface AuditEvent {
  type: string;
  request_id: string | null;
  status: string | null;
  details: Record<string, unknown>;
  at: string;
}

interface WalletEntry {
  pubkey: string;
  apiKey: string;
  walletId: string;
  label: string;
  events: AuditEvent[];
  error?: string;
  hasMore: boolean;
  page: number;
}

interface WalletKeyInfo {
  pubkey: string;
  apiKey: string;
  label?: string;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  withdraw: 'bg-orange-50 text-orange-700 border-orange-200',
  withdraw_pending_approval: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  withdraw_auto_executed: 'bg-lime-500/10 text-lime-400 border-lime-500/20',
  deposit: 'bg-lime-500/10 text-lime-400 border-lime-500/20',
  policy_change: 'bg-purple-50 text-purple-700 border-purple-200',
  approval: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  freeze: 'bg-red-500/10 text-red-400 border-red-500/20',
  unfreeze: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
};

const PAGE_SIZE = 50;

export default function WalletAuditPage() {
  const { network } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);
  const searchParams = new URLSearchParams(useLocation().search);

  const [selectedWallet, setSelectedWallet] = useState<string>('all');
  const [manualKeyInput, setManualKeyInput] = useState('');
  const [manualKeys, setManualKeys] = useState<WalletKeyInfo[]>([]);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  // Get saved keys from localStorage (read once)
  const savedKeys = useQuery({
    queryKey: ['saved-wallet-keys'],
    queryFn: () => {
      const saved = getAllWalletKeys();
      const keyMap = new Map<string, WalletKeyInfo>();

      const keyFromUrl = searchParams.get('key');
      if (keyFromUrl) {
        keyMap.set(keyFromUrl, { pubkey: '_url', apiKey: keyFromUrl, label: 'URL key' });
      }

      for (const [pubkey, stored] of Object.entries(saved)) {
        if (!keyMap.has(stored.apiKey)) {
          keyMap.set(stored.apiKey, { pubkey, apiKey: stored.apiKey, label: stored.label });
        }
      }

      const entries = Array.from(keyMap.values());
      return entries;
    },
    staleTime: 60_000,
  });

  // All known keys: saved + manual
  const allKeys = [...(savedKeys.data || []), ...manualKeys];

  // Auto-select single wallet from URL key
  useEffect(() => {
    const keyFromUrl = searchParams.get('key');
    if (keyFromUrl && allKeys.length === 1) {
      setSelectedWallet('_single');
    }
  }, [searchParams, allKeys.length]);

  // Fetch audit data for each key
  const walletQueries = useQuery({
    queryKey: ['audit-wallets', allKeys.map(k => k.apiKey).join(','), coordinatorUrl],
    queryFn: async () => {
      if (allKeys.length === 0) return [];

      const results = await Promise.allSettled(
        allKeys.map(async (entry) => {
          const addrResp = await fetch(`${coordinatorUrl}/wallet/v1/address?chain=near`, {
            headers: { 'Authorization': `Bearer ${entry.apiKey}` },
          });
          if (!addrResp.ok) {
            const err = await addrResp.json().catch(() => ({ error: addrResp.statusText }));
            throw new Error(err.error || err.message || `API error: ${addrResp.status}`);
          }
          const addrData = await addrResp.json();
          const walletId = addrData.wallet_id as string;

          const params = new URLSearchParams({
            limit: PAGE_SIZE.toString(),
            offset: '0',
          });
          const auditResp = await fetch(`${coordinatorUrl}/wallet/v1/audit?${params}`, {
            headers: { 'Authorization': `Bearer ${entry.apiKey}` },
          });
          if (!auditResp.ok) {
            const err = await auditResp.json().catch(() => ({ error: auditResp.statusText }));
            throw new Error(err.error || err.message || `API error: ${auditResp.status}`);
          }
          const auditData = await auditResp.json();
          const events: AuditEvent[] = auditData.events || [];

          return {
            pubkey: entry.pubkey,
            apiKey: entry.apiKey,
            walletId,
            label: entry.label || walletId.substring(0, 16),
            events,
            hasMore: events.length === PAGE_SIZE,
            page: 0,
          } as WalletEntry;
        })
      );

      return results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          ...allKeys[i],
          walletId: '',
          label: allKeys[i].label || allKeys[i].pubkey.substring(0, 16),
          events: [],
          error: (r.reason as Error).message,
          hasMore: false,
          page: 0,
        } as WalletEntry;
      });
    },
    enabled: allKeys.length > 0,
    staleTime: 2 * 60_000,
  });

  // Per-wallet page fetch query
  const [pageFetch, setPageFetch] = useState<{ walletId: string; page: number; apiKey: string; pubkey: string; label: string } | null>(null);

  const pageQuery = useQuery({
    queryKey: ['audit-page', pageFetch?.walletId, pageFetch?.page, pageFetch?.apiKey],
    queryFn: async () => {
      if (!pageFetch) return null;

      const addrResp = await fetch(`${coordinatorUrl}/wallet/v1/address?chain=near`, {
        headers: { 'Authorization': `Bearer ${pageFetch.apiKey}` },
      });
      const addrData = await addrResp.json();

      const params = new URLSearchParams({
        limit: PAGE_SIZE.toString(),
        offset: (pageFetch.page * PAGE_SIZE).toString(),
      });
      const auditResp = await fetch(`${coordinatorUrl}/wallet/v1/audit?${params}`, {
        headers: { 'Authorization': `Bearer ${pageFetch.apiKey}` },
      });
      const auditData = await auditResp.json();

      return {
        pubkey: pageFetch.pubkey,
        apiKey: pageFetch.apiKey,
        walletId: addrData.wallet_id,
        label: pageFetch.label,
        events: auditData.events || [],
        hasMore: (auditData.events || []).length === PAGE_SIZE,
        page: pageFetch.page,
      } as WalletEntry;
    },
    enabled: !!pageFetch,
  });

  // Merge base wallets with paged wallet
  const wallets = walletQueries.data || [];
  const finalWallets = wallets.map(w => {
    if (pageQuery.data && pageQuery.data.walletId === w.walletId) {
      return pageQuery.data;
    }
    return w;
  });

  const loadPage = (walletId: string, newPage: number) => {
    const wallet = finalWallets.find(w => w.walletId === walletId);
    if (!wallet) return;
    setPageFetch({ walletId, page: newPage, apiKey: wallet.apiKey, pubkey: wallet.pubkey, label: wallet.label });
  };

  const handleManualKeySubmit = () => {
    const key = manualKeyInput.trim();
    if (!key) return;
    setManualKeyInput('');

    // Check if already added
    if (allKeys.some(k => k.apiKey === key)) return;

    setManualKeys(prev => [...prev, { pubkey: '_manual', apiKey: key, label: 'Manual key' }]);
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

  const shortenId = (id: string) => {
    if (id.length <= 24) return id;
    return `${id.substring(0, 12)}...${id.substring(id.length - 8)}`;
  };

  const isPageLoading = pageQuery.isFetching && !pageQuery.isPending;
  const multiWallet = finalWallets.length > 1;
  const visibleWallets = selectedWallet === 'all' || selectedWallet === '_single'
    ? finalWallets
    : finalWallets.filter(w => w.walletId === selectedWallet);

  const mergedEvents = visibleWallets
    .flatMap(w => w.events.map(e => ({ ...e, _walletId: w.walletId, _walletLabel: w.label })))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const singleWallet = visibleWallets.length === 1 ? visibleWallets[0] : null;
  const errors = visibleWallets.filter(w => w.error).map(w => `${w.label}: ${w.error}`);
  const noKeys = allKeys.length === 0 && !savedKeys.isLoading && !manualKeys.length;

  if (noKeys) {
    return (
      <div className="max-w-6xl mx-auto px-4 pt-4">
        <Card>
          <CardContent className="p-8">
            <p className="text-zinc-600 mb-4">
              No saved wallet keys found. Enter an API key to view the audit log.
            </p>
            <div className="flex gap-3">
              <Input
                type="text"
                value={manualKeyInput}
                onChange={(e) => setManualKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualKeySubmit()}
                placeholder="wk_..."
                className="flex-1 font-mono text-sm"
              />
              <Button onClick={handleManualKeySubmit} disabled={!manualKeyInput.trim()}>
                Load
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pt-4">
      {/* Manual key input (always visible) */}
      <div className="flex gap-3 mb-4">
        <Input
          type="text"
          value={manualKeyInput}
          onChange={(e) => setManualKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleManualKeySubmit()}
          placeholder="Add API key..."
          className="flex-1 font-mono text-sm"
        />
        <Button onClick={handleManualKeySubmit} disabled={!manualKeyInput.trim()} variant="outline" size="sm">
          Add
        </Button>
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
          {finalWallets.map(w => (
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
              {w.error && <span className="ml-1 text-red-400">!</span>}
            </button>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4 bg-red-500/100/10 border-l-4 border-red-500 rounded-r-lg p-4">
          {errors.map((e, i) => (
            <p key={i} className="text-sm text-red-400">{e}</p>
          ))}
        </div>
      )}

      {/* Events table */}
      {!walletQueries.isSuccess ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          <span className="ml-3 text-zinc-400">Loading audit log...</span>
        </div>
      ) : mergedEvents.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-zinc-500">No audit events found.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table - hidden on mobile */}
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
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Details
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Request
                  </th>
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {mergedEvents.map((event, i) => (
                  <tr key={`dt-${event._walletId}-${i}`} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-zinc-500">
                      {formatDate(event.at)}
                    </td>
                    {multiWallet && selectedWallet === 'all' && (
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-zinc-400 font-mono">
                        {event._walletLabel}
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${EVENT_TYPE_COLORS[event.type] || 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {event.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-600 max-w-md">
                      <pre className="whitespace-pre-wrap break-all">
                        {(JSON.stringify(event.details ?? {}, null, 2) || '{}').substring(0, 200)}
                        {(JSON.stringify(event.details ?? {}) || '{}').length > 200 ? '...' : ''}
                      </pre>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 font-mono">
                      {event.request_id ? shortenId(event.request_id) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card layout - hidden on desktop */}
          <div className="sm:hidden space-y-3">
            {mergedEvents.map((event, i) => {
              const isExpanded = expandedCards.has(i);
              const detailsJson = JSON.stringify(event.details ?? {}, null, 2) || '{}';
              return (
                <Card key={`mc-${event._walletId}-${i}`} className="border-zinc-200">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${EVENT_TYPE_COLORS[event.type] || 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {event.type}
                      </Badge>
                      <span className="text-xs text-zinc-400">{formatDate(event.at)}</span>
                    </div>
                    {multiWallet && selectedWallet === 'all' && (
                      <p className="text-xs text-zinc-400 font-mono mb-1">{event._walletLabel}</p>
                    )}
                    {event.request_id && (
                      <p className="text-xs text-zinc-400 font-mono">req: {shortenId(event.request_id)}</p>
                    )}
                    <button
                      onClick={() => setExpandedCards(prev => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                      className="mt-2 text-xs text-zinc-900 hover:underline font-medium"
                    >
                      {isExpanded ? 'Hide details' : 'Show details'}
                    </button>
                    {isExpanded && (
                      <pre className="mt-2 text-xs text-zinc-600 whitespace-pre-wrap break-all bg-zinc-50 rounded-lg p-2">
                        {detailsJson.substring(0, 300)}{detailsJson.length > 300 ? '...' : ''}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination - only when single wallet is focused */}
          {singleWallet && (
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                onClick={() => loadPage(singleWallet.walletId, Math.max(0, singleWallet.page - 1))}
                disabled={singleWallet.page === 0 || isPageLoading}
              >
                Previous
              </Button>
              <span className="text-sm text-zinc-500">Page {singleWallet.page + 1}</span>
              <Button
                variant="outline"
                onClick={() => loadPage(singleWallet.walletId, singleWallet.page + 1)}
                disabled={!singleWallet.hasMore || isPageLoading}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}