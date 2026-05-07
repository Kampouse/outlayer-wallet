import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useNearWallet } from '@/contexts/NearWalletContext';
import WalletConnectionModal from '@/components/WalletConnectionModal';
import { getCoordinatorApiUrl } from '@/lib/api';
import { Link } from 'react-router-dom';
import { saveWalletKey, computeKeyHash } from '@/lib/wallet-keys';
import { submitPolicy, parsePolicyResponse } from '@/lib/wallet-policy';
import { useApiKeyHash } from '@/hooks/useApiKeyHash';
import { usePolicyForm } from '@/hooks/usePolicyForm';
import { PolicyFormFields } from '@/components/wallet/PolicyFormFields';
import { PolicyJsonEditor } from '@/components/wallet/PolicyJsonEditor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

interface WalletInfo {
  wallet_id: string;
  address: string;
  chain: string;
}

export default function WalletHandoffPage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto py-8 text-zinc-400">Loading...</div>}>
      <WalletHandoffContent />
    </Suspense>
  );
}

function WalletHandoffContent() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const apiKey = searchParams.get('key');

  const {
    accountId,
    isConnected,
    network,
    contractId,
    viewMethod,
    signAndSendTransaction,
  } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [existingPolicy, setExistingPolicy] = useState<boolean | null>(null);

  // Owner mode: connect wallet or enter manually
  const [ownerMode, setOwnerMode] = useState<'wallet' | 'manual'>('wallet');
  const [manualOwner, setManualOwner] = useState('');

  // The effective owner account
  const effectiveOwner = ownerMode === 'wallet' ? accountId : (manualOwner.trim() || null);
  const ownerReady = ownerMode === 'wallet' ? isConnected : !!manualOwner.trim();

  // SHA256 hash of current API key (for authorized_key_hashes in policy)
  const apiKeyHash = useApiKeyHash(apiKey);

  // Build knownKeyHashes map from the handoff API key
  const [knownKeyHashes, setKnownKeyHashes] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (apiKey && apiKeyHash) {
      setKnownKeyHashes(new Map([[apiKeyHash, 'current handoff key']]));
    }
  }, [apiKey, apiKeyHash]);

  const handleSaveKey = useCallback((newKey: string) => {
    if (walletInfo) {
      const pk = `ed25519:${walletInfo.address}`;
      saveWalletKey(pk, newKey, 'generated key');
    }
  }, [walletInfo]);

  // Approval
  const [requireApproval, setRequireApproval] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState('1');
  const [additionalApprovers, setAdditionalApprovers] = useState('');
  // Which types require approval (unchecked = excluded_types)
  const allTxTypes = ['transfer', 'call', 'delete', 'intents_withdraw', 'intents_swap', 'intents_deposit'] as const;
  const [approvalTypes, setApprovalTypes] = useState<Set<string>>(new Set(['transfer', 'call', 'delete', 'intents_withdraw']));

  // Policy form with augmentPolicy that adds owner-based approval
  const {
    policyForm,
    setPolicyForm,
    policyJsonText,
    setPolicyJsonText,
    jsonEdited,
    setJsonEdited,
    resetJson,
  } = usePolicyForm({
    apiKeyHash,
    augmentPolicy: useCallback((base: Record<string, unknown>) => {
      const required = parseInt(approvalRequired, 10);
      // No approval needed: toggle off, required set to 0, or no types selected
      if (!requireApproval || required === 0 || approvalTypes.size === 0) return base;
      const approvers: Array<{ id: string; role: string }> = [{ id: effectiveOwner || '', role: 'admin' }];
      if (additionalApprovers.trim()) {
        additionalApprovers.split('\n').filter((l) => l.trim()).forEach((line) => {
          const [id, role] = line.split(',').map((s) => s.trim());
          if (id) approvers.push({ id, role: role || 'signer' });
        });
      }
      const excluded_types = allTxTypes.filter((t) => !approvalTypes.has(t));
      return {
        ...base,
        approval: {
          threshold: { required },
          ...(excluded_types.length > 0 ? { excluded_types } : {}),
          approvers,
        },
      };
    }, [requireApproval, approvalRequired, additionalApprovers, effectiveOwner, approvalTypes]),
  });

  // Fetch wallet info using the API key
  const loadWalletInfo = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(null);
    console.log('[handoff] loadWalletInfo, apiKey:', apiKey?.substring(0, 10));

    try {
      const resp = await fetch(`${coordinatorUrl}/wallet/v1/address?chain=near`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      console.log('[handoff] wallet info response:', resp.status);

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.message || `Failed to fetch wallet info (HTTP ${resp.status})`);
      }

      const data = await resp.json();
      console.log('[handoff] wallet info:', data);
      setWalletInfo({
        wallet_id: data.wallet_id,
        address: data.address,
        chain: 'near',
      });
    } catch (err) {
      console.error('[handoff] loadWalletInfo error:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiKey, coordinatorUrl]);

  // Check if policy already exists on-chain, and if so load it into the form
  const checkExistingPolicy = useCallback(async () => {
    if (!walletInfo || !apiKey) {
      console.log('[handoff] checkExistingPolicy skipped, walletInfo:', !!walletInfo, 'apiKey:', !!apiKey);
      return;
    }

    try {
      const walletPubkey = `ed25519:${walletInfo.address}`;
      console.log('[handoff] checking policy for:', walletPubkey);
      const result = await viewMethod({
        contractId,
        method: 'get_wallet_policy',
        args: { wallet_pubkey: walletPubkey },
      }).catch(() => null);
      console.log('[handoff] on-chain policy result:', result);

      const exists = result !== null;
      setExistingPolicy(exists);
      console.log('[handoff] policy exists:', exists, 'ownerReady:', ownerReady);

      // Load current policy from coordinator and pre-fill the form
      if (exists) {
        try {
          const resp = await fetch(`${coordinatorUrl}/wallet/v1/policy`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          console.log('[handoff] coordinator policy response:', resp.status);
          if (resp.ok) {
            const data = await resp.json();
            console.log('[handoff] coordinator policy data:', data);
            const parsed = parsePolicyResponse(data, apiKeyHash || undefined);
            console.log('[handoff] parsed policy form:', parsed.form);
            setPolicyForm(parsed.form);

            if (parsed.approval) {
              const req = parseInt(parsed.approval.required, 10);
              setRequireApproval(req > 0);
              setApprovalRequired(parsed.approval.required);
              setAdditionalApprovers(
                // Remove owner since it's auto-added — match by account_id, not role
                parsed.approval.approvers
                  .split('\n')
                  .filter((line) => {
                    const id = line.split(',').map((s) => s.trim())[0] || '';
                    return id !== effectiveOwner;
                  })
                  .join('\n')
              );
              // Restore approvalTypes from excluded_types
              const excluded = (data.approval?.excluded_types || []) as string[];
              setApprovalTypes(new Set(allTxTypes.filter((t) => !excluded.includes(t))));
            }
          }
        } catch {
          // Failed to load — form stays default
        }
      }
    } catch {
      setExistingPolicy(false);
    }
  }, [walletInfo, contractId, viewMethod, apiKey, coordinatorUrl, apiKeyHash, setPolicyForm, setRequireApproval, setApprovalRequired, setAdditionalApprovers]);

  useEffect(() => {
    loadWalletInfo();
  }, [loadWalletInfo]);

  useEffect(() => {
    if (walletInfo) {
      checkExistingPolicy();
    }
  }, [walletInfo, checkExistingPolicy]);

  const handleSubmitPolicy = async () => {
    if (!effectiveOwner || !walletInfo) return;

    // Manual mode requires connected wallet to sign the transaction
    if (ownerMode === 'manual' && !isConnected) {
      setError('Connect your NEAR wallet to sign the transaction. The manual account will be set as owner.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const { walletPubkey } = await submitPolicy({
        coordinatorUrl,
        apiKey: apiKey!,
        walletId: walletInfo.wallet_id,
        policyJsonText,
        contractId,
        viewMethod,
        signAndSendTransaction,
      });

      // Save API key to browser localStorage for approvals
      saveWalletKey(walletPubkey, apiKey!);

      setSuccess('Policy stored on-chain! Redirecting to wallet management...');
      setExistingPolicy(true);
      setTimeout(() => navigate('/wallet/manage'), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // No API key provided
  if (!apiKey) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-4">Wallet Handoff</h1>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-zinc-600 mb-4">
              This page is used to take control of an AI agent wallet.
            </p>
            <p className="text-sm text-zinc-500">
              Your agent should have given you a handoff URL like:<br />
              <code className="text-xs bg-zinc-100 px-2 py-1 rounded mt-1 inline-block">
                /wallet?key=wk_...
              </code>
            </p>
            <div className="mt-6">
              <Link to="/wallet/manage"
                className="text-zinc-900 hover:underline font-medium"
              >
                Or manage existing wallets &rarr;
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-2">Wallet Handoff</h1>
      <p className="text-zinc-500 mb-6">
        Take control of your AI agent&apos;s wallet by setting a spending policy.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-400 rounded-r-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-emerald-50 border-l-4 border-emerald-400 rounded-r-lg p-4">
          <p className="text-sm text-emerald-700">{success}</p>
        </div>
      )}

      {/* Step 1: Wallet Info */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-zinc-900 mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 text-white text-xs mr-2">1</span>
            Wallet Info
          </h2>

          {loading ? (
            <div className="flex items-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400 mr-3" />
              <span className="text-zinc-500">Loading wallet...</span>
            </div>
          ) : walletInfo ? (
            <div className="space-y-2">
              <div>
                <span className="text-xs text-zinc-400 uppercase tracking-wide">Wallet ID</span>
                <p className="text-sm font-mono text-zinc-900 break-all">{walletInfo.wallet_id}</p>
              </div>
              <div>
                <span className="text-xs text-zinc-400 uppercase tracking-wide">NEAR Address (implicit)</span>
                <p className="text-sm font-mono text-zinc-900 break-all">{walletInfo.address}</p>
              </div>
              {existingPolicy === true && (
                <div className="mt-2 bg-blue-50 border-l-4 border-blue-400 rounded-r-lg p-2">
                  <p className="text-sm text-blue-700">This wallet already has a policy on-chain. Submitting a new one will replace it.</p>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 2: Policy Owner */}
      {walletInfo && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-zinc-900 mb-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 text-white text-xs mr-2">2</span>
              Policy Owner
            </h2>

            <p className="text-sm text-zinc-500 mb-4">
              The owner can freeze the wallet, update the policy, and approve transactions.
            </p>

            <div className="flex space-x-3 mb-4">
              <button
                type="button"
                onClick={() => setOwnerMode('wallet')}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  ownerMode === 'wallet'
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                }`}
              >
                Connect Wallet
              </button>
              <button
                type="button"
                onClick={() => setOwnerMode('manual')}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  ownerMode === 'manual'
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                }`}
              >
                Enter Account ID
              </button>
            </div>

            {ownerMode === 'wallet' ? (
              isConnected ? (
                <p className="text-sm text-emerald-700">
                  Connected as <span className="font-mono font-medium">{accountId}</span>
                </p>
              ) : (
                <div>
                  <Button onClick={() => setShowWalletModal(true)}>
                    Connect Wallet
                  </Button>
                </div>
              )
            ) : (
              <div>
                <Input
                  type="text"
                  value={manualOwner}
                  onChange={(e) => setManualOwner(e.target.value)}
                  placeholder="e.g. alice.near"
                  className="font-mono"
                />
                <p className="text-xs text-zinc-400 mt-1">
                  This NEAR account will be the policy owner. You still need to connect a wallet to sign the transaction.
                </p>
                {manualOwner.trim() && !isConnected && (
                  <div className="mt-3">
                    <Button variant="outline" onClick={() => setShowWalletModal(true)}>
                      Connect wallet to sign transaction
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Set Policy — wait for existing policy check so form shows current values, not defaults */}
      {walletInfo && ownerReady && existingPolicy !== null && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-zinc-900 mb-6">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 text-white text-xs mr-2">3</span>
              Set Spending Policy
            </h2>

            <div className="space-y-6">
              {/* Transaction Approval */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-800">Transaction Approval</h3>

                {/* Toggle */}
                <div
                  className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                    requireApproval
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <div
                    className="cursor-pointer"
                    onClick={() => setRequireApproval(!requireApproval)}
                  >
                    <p className={`font-medium ${requireApproval ? 'text-emerald-900' : 'text-zinc-900'}`}>
                      Require personal approval
                    </p>
                    <p className={`text-sm mt-0.5 ${requireApproval ? 'text-emerald-600' : 'text-zinc-500'}`}>
                      Transactions need your approval before execution
                    </p>
                  </div>
                  <Checkbox
                    checked={requireApproval}
                    onCheckedChange={(v) => setRequireApproval(!!v)}
                  />
                </div>

                {requireApproval && (
                  <div className="space-y-4 pl-0" onClick={(e) => e.stopPropagation()}>
                    {/* Approvers section */}
                    <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
                      {/* Primary approver */}
                      <div className="p-4">
                        <label className="block text-xs font-medium text-zinc-500 mb-2">Required Approvals</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={approvalRequired}
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^0-9]/g, '');
                              setApprovalRequired(v);
                              if (v === '' || parseInt(v, 10) === 0) setRequireApproval(false);
                            }}
                            placeholder="e.g. 1"
                          />
                          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg min-h-[38px]">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <span className="text-sm font-mono text-zinc-700 truncate">{effectiveOwner}</span>
                            <span className="text-xs text-zinc-400 shrink-0 ml-auto">admin</span>
                          </div>
                        </div>
                      </div>

                      {/* Additional approvers */}
                      <div className="p-4">
                        <label className="block text-xs font-medium text-zinc-500 mb-2">
                          Additional Approvers
                        </label>
                        <textarea
                          value={additionalApprovers}
                          onChange={(e) => setAdditionalApprovers(e.target.value)}
                          placeholder={"alice.near, signer\nbob.near, signer"}
                          rows={2}
                          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
                        />
                        <p className="text-xs text-zinc-400 mt-1.5">One per line — format: account_id, role. Roles: admin or signer.</p>
                      </div>
                    </div>

                    {/* Transaction types */}
                    <div className="rounded-lg border border-zinc-200">
                      <div className="px-4 py-3 border-b border-zinc-100">
                        <label className="block text-xs font-medium text-zinc-500">Require approval for</label>
                      </div>
                      {(() => {
                        const txTypeLabels: Record<string, { label: string; desc: string }> = {
                          transfer: { label: 'Transfer', desc: 'Send native currency' },
                          call: { label: 'Contract call', desc: 'Smart contract interaction' },
                          delete: { label: 'Delete wallet', desc: 'Remove the wallet' },
                          intents_withdraw: { label: 'Cross-chain', desc: 'Send via NEAR Intents' },
                          intents_swap: { label: 'Swap', desc: 'Token swap via Intents' },
                          intents_deposit: { label: 'Deposit', desc: 'Deposit to Intents' },
                        };
                        const directTypes = ['transfer', 'call', 'delete'] as const;
                        const intentsTypes = ['intents_withdraw', 'intents_swap', 'intents_deposit'] as const;
                        const renderToggle = (txType: string) => {
                          const info = txTypeLabels[txType];
                          const checked = approvalTypes.has(txType);
                          return (
                            <div
                              key={txType}
                              className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-50 ${
                                txType === 'intents_withdraw' ? 'border-t border-zinc-100' : ''
                              }`}
                            >
                              <div
                                className="min-w-0 cursor-pointer"
                                onClick={() => {
                                  setApprovalTypes((prev) => {
                                    const next = new Set(prev);
                                    next.has(txType) ? next.delete(txType) : next.add(txType);
                                    return next;
                                  });
                                }}
                              >
                                <p className={`text-sm font-medium ${checked ? 'text-zinc-900' : 'text-zinc-500'}`}>{info.label}</p>
                                <p className="text-xs text-zinc-400 truncate">{info.desc}</p>
                              </div>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => {
                                  setApprovalTypes((prev) => {
                                    const next = new Set(prev);
                                    v ? next.add(txType) : next.delete(txType);
                                    return next;
                                  });
                                }}
                              />
                            </div>
                          );
                        };
                        return (
                          <div>
                            {directTypes.map(renderToggle)}
                            <div className="mx-4 my-2 py-1.5 border-t border-zinc-100" />
                            <div className="px-4 py-2 bg-zinc-50/50">
                              <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">NEAR Intents</span>
                            </div>
                            {intentsTypes.map(renderToggle)}
                          </div>
                        );
                      })()}
                      <div className="px-4 py-2.5 border-t border-zinc-100 bg-zinc-50/50">
                        <p className="text-[11px] text-zinc-400">Unchecked types execute immediately without approval.</p>
                        {(approvalTypes.has('intents_swap') || approvalTypes.has('intents_deposit')) && (
                          <p className="text-[11px] text-amber-600 font-medium mt-1">
                            Intents deposit &amp; swap use expiring quotes — approval delays may cause failures.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Shared policy form fields */}
              <PolicyFormFields policyForm={policyForm} onChange={setPolicyForm} apiKeyHash={apiKeyHash} knownKeyHashes={knownKeyHashes} onSaveKey={handleSaveKey} />
            </div>

            {/* Policy JSON Editor */}
            <PolicyJsonEditor
              policyJsonText={policyJsonText}
              onChangeText={(text) => { setPolicyJsonText(text); setJsonEdited(true); }}
              jsonEdited={jsonEdited}
              onReset={resetJson}
            />

            <div className="mt-4 pt-4 border-t flex items-center justify-between">
              <p className="text-xs text-zinc-400">
                Policy will be encrypted in TEE and stored on-chain with <span className="font-mono">{effectiveOwner}</span> as owner.
              </p>
              <Button
                onClick={handleSubmitPolicy}
                disabled={submitting || !isConnected}
              >
                {submitting ? 'Encrypting & Storing...' : 'Store Policy On-Chain'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* After success — next steps */}
      {success && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-zinc-900 mb-3">Next Steps</h2>
            <ul className="space-y-2 text-sm text-zinc-600">
              <li>
                <Link to={`/wallet/approvals?key=${apiKey}`} className="text-zinc-900 hover:underline font-medium">
                  Approvals
                </Link>
                {' '}&mdash; review and approve pending transactions
              </li>
              <li>
                <Link to={`/wallet/manage?key=${apiKey}`} className="text-zinc-900 hover:underline font-medium">
                  Manage Wallets
                </Link>
                {' '}&mdash; edit policy, freeze wallet
              </li>
              <li>
                <Link to={`/wallet/audit?key=${apiKey}`} className="text-zinc-900 hover:underline font-medium">
                  Audit Log
                </Link>
                {' '}&mdash; view transaction history
              </li>
            </ul>
          </CardContent>
        </Card>
      )}

      <WalletConnectionModal isOpen={showWalletModal} onClose={() => setShowWalletModal(false)} />
    </div>
  );
}
