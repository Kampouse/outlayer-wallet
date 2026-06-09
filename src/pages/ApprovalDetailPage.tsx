import { useState, useEffect, useCallback, Suspense } from 'react';
import { getCoordinatorApiUrl } from '@/lib/api';
import { useNearWallet } from '@/contexts/NearWalletContext';
import { Link } from 'react-router-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft } from 'lucide-react';

interface ApprovalDetail {
  id: string;
  wallet_id: string;
  request_type: string;
  request_data: Record<string, unknown>;
  request_hash: string;
  required_approvals: number;
  status: string;
  expires_at: string;
  created_at: string;
  approvers: { approver_id: string; approver_role: string; signature: string; created_at: string }[];
}

export default function ApprovalDetailPage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto py-8 text-muted-foreground">Loading...</div>}>
      <ApprovalDetailContent />
    </Suspense>
  );
}

function ApprovalDetailContent() {
  const params = useParams();
  const navigate = useNavigate();
  const approvalId = params.id as string;

  const { network, contractId, signMessage, isConnected } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);

  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadApproval = useCallback(async () => {
    if (!approvalId) return;
    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(
        `${coordinatorUrl}/wallet/v1/approval/${encodeURIComponent(approvalId)}`
      );
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to load approval: ${resp.status}`);
      }
      const data = await resp.json();
      setApproval(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [approvalId, coordinatorUrl]);

  useEffect(() => {
    loadApproval();
  }, [loadApproval]);

  const handleApprove = async () => {
    if (!approval) return;

    if (!isConnected) {
      setError('Connect your NEAR wallet to approve.');
      return;
    }

    setApproving(true);
    setError(null);

    try {
      // Generate 32-byte random nonce
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonceBase64 = Buffer.from(nonceBytes).toString('base64');

      // Build NEP-413 message: "approve:{approval_id}:{request_hash}"
      const message = `approve:${approval.id}:${approval.request_hash}`;

      // Sign with NEAR wallet (NEP-413)
      const signed = await signMessage({
        message,
        recipient: contractId,
        nonce: nonceBase64,
      });

      if (!signed) {
        throw new Error('Signature cancelled');
      }

      const resp = await fetch(
        `${coordinatorUrl}/wallet/v1/approve/${approval.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signature: signed.signature,
            public_key: signed.publicKey,
            account_id: signed.accountId,
            nonce: nonceBase64,
          }),
        }
      );

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `Approval failed: ${resp.status}`);
      }

      const result = await resp.json();
      if (result.request_id) {
        // Threshold met — redirect to audit page
        navigate('/wallet/audit');
        return;
      } else {
        setSuccess(`Approved (${result.approved}/${result.required}). Waiting for more approvals.`);
      }

      setTimeout(() => loadApproval(), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false);
    }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();
  const isExpired = approval ? new Date(approval.expires_at) < new Date() : false;
  const backUrl = '/wallet/approvals';

  return (
    <div className="max-w-4xl mx-auto px-4">
      <div className="flex items-center space-x-3 mb-6">
        <Link to={backUrl} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
          <ArrowLeft className="w-4 h-4" />
          Back to Approvals
        </Link>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">Approval Details</h1>

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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading...</span>
        </div>
      ) : !approval ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Approval not found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Status card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Badge
                    variant={approval.status === 'pending' ? 'outline' : approval.status === 'approved' ? 'secondary' : approval.status === 'expired' ? 'secondary' : 'destructive'}
                    className={approval.status === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-400' : approval.status === 'approved' ? 'bg-lime-50 text-lime-400 border-lime-200' : approval.status === 'expired' ? 'bg-muted text-muted-foreground border-border' : ''}
                  >
                    {approval.status.toUpperCase()}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{approval.request_type}</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {approval.approvers?.length || 0} / {approval.required_approvals} approved
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Wallet</p>
                  <p className="font-mono text-foreground text-xs break-all mt-1">{approval.wallet_id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Request Hash</p>
                  <p className="font-mono text-foreground text-xs break-all mt-1">{approval.request_hash}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Created</p>
                  <p className="text-foreground mt-1">{formatDate(approval.created_at)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Expires</p>
                  <p className={`${isExpired ? 'text-red-400' : 'text-foreground'} mt-1`}>
                    {formatDate(approval.expires_at)}
                    {isExpired && ' (EXPIRED)'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Request data */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-foreground mb-3">Request Data</h2>
              <pre className="bg-muted border border-border rounded-lg p-4 text-sm text-foreground overflow-x-auto">
                {JSON.stringify(approval.request_data, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {/* Existing approvers */}
          {approval.approvers && approval.approvers.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-foreground mb-3">Approvers</h2>
                <div className="space-y-2">
                  {approval.approvers.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-lime-50 border border-lime-100 rounded-lg p-3">
                      <div>
                        <p className="text-sm font-mono text-foreground">{a.approver_id}</p>
                        <p className="text-xs text-muted-foreground">Role: {a.approver_role}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatDate(a.created_at)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Approve button */}
          {approval.status === 'pending' && !isExpired && (
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => navigate(backUrl)}
              >
                Back
              </Button>
              <Button
                onClick={handleApprove}
                disabled={approving || !isConnected}
              >
                {approving ? 'Approving...' : 'Approve'}
              </Button>
            </div>
          )}

          {!isConnected && approval.status === 'pending' && (
            <div className="bg-amber-500/10 border-l-4 border-amber-500 rounded-r-lg p-4">
              <p className="text-sm text-amber-800">
                Connect your NEAR wallet to approve this request.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}