import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from '@/contexts/NearWalletContext';
import WalletConnectionModal from '@/components/WalletConnectionModal';
import { getCoordinatorApiUrl } from '@/lib/api';
import { findKeyForWallets, saveWalletKey } from '@/lib/wallet-keys';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

interface PendingApproval {
  id: string;
  wallet_id: string;
  request_type: string;
  request_data: Record<string, unknown>;
  required_approvals: number;
  approved_count: number;
  request_hash: string;
  expires_at: string;
  created_at: string;
  // display helpers
  wallet_pubkey?: string;
}

const APPROVALS_KEY = 'pending-approvals';

export default function WalletApprovalsPage() {
  const { accountId, isConnected, network, contractId, viewMethod, signMessage } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);
  const searchParams = new URLSearchParams(useLocation().search);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // API key for reject action
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState(false);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);

  // Read API key from URL params on mount
  useEffect(() => {
    const keyFromUrl = searchParams.get('key');
    if (keyFromUrl) {
      setApiKey(keyFromUrl);
    }
  }, [searchParams]);

  // Fetch wallet pubkeys + pending approvals in one query
  const {
    data: approvals = [],
    isSuccess: approvalsLoaded,
  } = useQuery({
    queryKey: [APPROVALS_KEY, accountId, contractId, coordinatorUrl],
    queryFn: async () => {
      if (!accountId || !contractId) return [];

      const wallets = await viewMethod({
        contractId,
        method: 'get_wallet_policies_by_owner',
        args: { owner: accountId },
      }).catch(() => []) as Array<{ wallet_pubkey: string }>;

      const pubkeys = wallets.map(w => w.wallet_pubkey);
      if (pubkeys.length === 0) return [];

      const allApprovals: PendingApproval[] = [];
      for (const pubkey of pubkeys) {
        try {
          const resp = await fetch(
            `${coordinatorUrl}/wallet/v1/pending_approvals_by_pubkey?near_pubkey=${encodeURIComponent(pubkey)}`
          );
          if (!resp.ok) continue;
          const data = await resp.json();
          if (data.pending_approvals) {
            for (const pa of data.pending_approvals) {
              allApprovals.push({ ...pa, wallet_pubkey: pubkey });
            }
          }
        } catch {
          // skip individual wallet errors
        }
      }
      return allApprovals;
    },
    enabled: !!accountId && !!contractId && isConnected,
    staleTime: 2 * 60_000,
    refetchInterval: 30_000,
  });

  // Try to load API key from localStorage when approvals load
  useEffect(() => {
    if (!apiKey && approvals.length > 0) {
      const walletPubkeys = approvals
        .map((a) => a.wallet_pubkey)
        .filter((pk): pk is string => !!pk);
      const savedKey = findKeyForWallets(walletPubkeys);
      if (savedKey) {
        setApiKey(savedKey);
      }
    }
  }, [approvals, apiKey]);

  // Approve mutation
  const handleApprove = async (approvalId: string) => {
    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) return;

    setApprovingId(approvalId);
    setError(null);
    setSuccess(null);

    try {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonceBase64 = Buffer.from(nonceBytes).toString('base64');
      const message = `approve:${approvalId}:${approval.request_hash}`;

      const signed = await signMessage({
        message,
        recipient: contractId,
        nonce: nonceBase64,
      });

      if (!signed) {
        throw new Error('Signature cancelled');
      }

      const resp = await fetch(`${coordinatorUrl}/wallet/v1/approve/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: signed.signature,
          public_key: signed.publicKey,
          account_id: signed.accountId,
          nonce: nonceBase64,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || err.message || `API error: ${resp.status}`);
      }
      const data = await resp.json();
      if (data.request_id) {
        const auditUrl = apiKey ? `/wallet/audit?key=${encodeURIComponent(apiKey)}` : '/wallet/audit';
        navigate(auditUrl);
        return;
      } else {
        setSuccess(`Approved (${data.approved}/${data.required}). Waiting for more approvals.`);
      }

      queryClient.invalidateQueries({ queryKey: [APPROVALS_KEY] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingId(null);
    }
  };

  // Reject mutation
  const handleReject = async (approvalId: string) => {
    if (!apiKey) {
      setPendingApprovalId(approvalId);
      setShowApiKeyPrompt(true);
      return;
    }

    if (!confirm('Reject this request? This cannot be undone.')) return;

    setApprovingId(approvalId);
    setError(null);
    setSuccess(null);

    try {
      const resp = await fetch(`${coordinatorUrl}/wallet/v1/reject/${approvalId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approver_account: accountId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || err.message || `API error: ${resp.status}`);
      }
      setSuccess('Request rejected.');
      queryClient.invalidateQueries({ queryKey: [APPROVALS_KEY] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleApiKeySubmit = () => {
    setShowApiKeyPrompt(false);
    if (pendingApprovalId && apiKey) {
      const approval = approvals.find((a) => a.id === pendingApprovalId);
      if (approval?.wallet_pubkey) {
        saveWalletKey(approval.wallet_pubkey, apiKey);
      }
      handleReject(pendingApprovalId);
    }
    setPendingApprovalId(null);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  const hasPolicies = approvals.length >= 0 && isConnected;

  // Not connected — show connect prompt
  if (!isConnected) {
    return (
    <div className="max-w-4xl mx-auto px-4 pt-4">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-zinc-500 mb-6">
              Connect your NEAR wallet to view pending approvals for your AI wallets.
            </p>
            <Button onClick={() => setShowWalletModal(true)}>
              Connect Wallet
            </Button>
          </CardContent>
        </Card>
        {showWalletModal && <WalletConnectionModal isOpen={showWalletModal} onClose={() => setShowWalletModal(false)} />}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pt-4">
      {approvals.length > 0 && (
        <div className="mb-4">
          <Badge variant="destructive" className="text-xs">
            {approvals.length}
          </Badge>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-lime-500/10 border-l-4 border-lime-500 rounded-r-lg p-4">
          <p className="text-sm text-lime-400">{success}</p>
        </div>
      )}

      {/* API key prompt dialog */}
      {showApiKeyPrompt && (
        <div className="mb-4 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-4">
          <p className="text-sm text-blue-400 mb-3">
            Enter the wallet API key to reject this request.
            It will be saved in this browser for future use.
          </p>
          <div className="flex gap-3">
            <Input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
              placeholder="wk_..."
              className="flex-1 font-mono text-sm"
              autoFocus
            />
            <Button
              onClick={handleApiKeySubmit}
              disabled={!apiKey.trim()}
            >
              Submit
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setShowApiKeyPrompt(false); setPendingApprovalId(null); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!approvalsLoaded ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          <span className="ml-3 text-zinc-400">Loading approvals...</span>
        </div>
      ) : !hasPolicies ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-zinc-500">No wallet policies found for this account.</p>
            <p className="text-sm text-zinc-400 mt-2">
              Go to <Link to="/" className="text-zinc-900 hover:underline font-medium">Wallets</Link> to set up policies for your AI wallets.
            </p>
          </CardContent>
        </Card>
      ) : approvals.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-zinc-500">No pending approvals.</p>
            <p className="text-sm text-zinc-400 mt-2">
              Approvals appear when a wallet operation requires multisig confirmation.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <Card
              key={approval.id}
              className={isExpired(approval.expires_at) ? "opacity-50" : ""}
            >
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline">
                        {approval.request_type}
                      </Badge>
                      {isExpired(approval.expires_at) && (
                        <Badge variant="secondary">Expired</Badge>
                      )}
                    </div>
                    {approval.wallet_pubkey && (
                      <p className="mt-1 text-xs text-zinc-400 font-mono">
                        Wallet: {approval.wallet_pubkey.substring(0, 24)}...
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-zinc-500">
                      {approval.approved_count} / {approval.required_approvals} approved
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Expires: {formatDate(approval.expires_at)}
                    </p>
                  </div>
                </div>

                {/* Request details */}
                <div className="mt-3 bg-zinc-50 rounded-lg p-3">
                  <pre className="text-xs text-zinc-600 overflow-x-auto">
                    {JSON.stringify(approval.request_data, null, 2)}
                  </pre>
                </div>

                {/* Action buttons */}
                {!isExpired(approval.expires_at) && (
                  <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-xs text-zinc-400">
                      Created: {formatDate(approval.created_at)}
                    </p>
                    <div className="flex sm:flex-row flex-col gap-2">
                      <Button
                        onClick={() => handleReject(approval.id)}
                        disabled={approvingId === approval.id}
                        variant="destructive"
                        size="sm"
                      >
                        Reject
                      </Button>
                      <Button
                        onClick={() => handleApprove(approval.id)}
                        disabled={approvingId === approval.id}
                        size="sm"
                      >
                        {approvingId === approval.id ? 'Processing...' : 'Approve'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}