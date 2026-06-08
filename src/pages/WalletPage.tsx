import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useNearWallet } from '@/contexts/NearWalletContext';
import { getOutlayerClient } from '@/lib/outlayer';
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
    isNearConnected,
    nearAccountId,
    network,
    contractId,
    viewMethod,
    signAndSendTransaction,
    requestNearLogin,
    closeLoginModal,
  } = useNearWallet();
  const coordinatorUrl = getCoordinatorApiUrl(network);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [existingPolicy, setExistingPolicy] = useState<boolean | null>(null);

  // Owner mode: connect wallet or enter manually
  const [ownerMode, setOwnerMode] = useState<'wallet' | 'manual'>('wallet');
  const [manualOwner, setManualOwner] = useState('');

  // The effective owner account — use nearAccountId (actual NEAR wallet) not accountId (may be Google-assigned)
  const effectiveOwner = ownerMode === 'wallet' ? nearAccountId : (manualOwner.trim() || null);
  const ownerReady = ownerMode === 'wallet' ? isNearConnected : !!manualOwner.trim();

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

    try {
      const client = getOutlayerClient(apiKey, network);
      const data = await client.getAddress('near');
      setWalletInfo({
        wallet_id: data.address,
        address: data.address,
        chain: data.chain || 'near',
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
      return;
    }

    try {
      const walletPubkey = `ed25519:${walletInfo.address}`;
      const result = await viewMethod({
        contractId,
        method: 'get_wallet_policy',
        args: { wallet_pubkey: walletPubkey },
      }).catch(() => null);

      const exists = result !== null;
      setExistingPolicy(exists);

      // Load current policy from coordinator and pre-fill the form
      if (exists) {
        try {
          const policyClient = getOutlayerClient(apiKey, network);
          const data = await policyClient.policy.get();
          const parsed = parsePolicyResponse(data, apiKeyHash || undefined);
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

    // Manual mode requires connected NEAR wallet to sign the transaction
    if (ownerMode === 'manual' && !isNearConnected) {
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
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Wallet Handoff</h1>
        <p className="text-muted-foreground mb-6">
          Take control of your AI agent&apos;s wallet by setting a spending policy.
        </p>
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                <rect x="2" y="5" width="20" height="14" rx="3" />
                <path d="M2 10h20" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-zinc-900 mb-1">No wallet key provided</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Create a new wallet or paste an existing API key.
            </p>
            <div className="flex flex-col items-center gap-3">
              <Button
                size="lg"
                onClick={async () => {
                  setSubmitting(true);
                  setError(null);
                  try {
                    const baseUrl = getCoordinatorApiUrl(network);
                    const serverKey = import.meta.env.VITE_OUTLAYER_SERVER_KEY;
                    const resp = await fetch(`${baseUrl}/register`, {
                      method: 'POST',
                      headers: serverKey ? { Authorization: `Bearer ${serverKey}` } : {},
                    });
                    if (!resp.ok) throw new Error(`Register failed: ${resp.status}`);
                    const data = await resp.json();
                    // Redirect with the new key
                    navigate(`/handoff?key=${encodeURIComponent(data.api_key)}`);
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSubmitting(false);
                  }
                }}
                disabled={submitting}
              >
                {submitting ? 'Creating...' : 'Create New Wallet'}
              </Button>
              <span className="text-xs text-zinc-400">or</span>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  const key = prompt('Paste your OutLayer API key (wk_...):');
                  if (key?.trim()) {
                    navigate(`/handoff?key=${encodeURIComponent(key.trim())}`);
                  }
                }}
              >
                Import API Key
              </Button>
              <div className="mt-4">
                <Link to="/wallet/manage" className="text-sm text-muted-foreground hover:underline">
                  Manage existing wallets →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Wallet Handoff</h1>
      <p className="text-muted-foreground mb-6">
        Take control of your AI agent&apos;s wallet by setting a spending policy.
      </p>

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

      {/* Step 1: Wallet Info */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs mr-2">1</span>
            Wallet Info
          </h2>

          {loading ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                <div className="h-4 w-48 bg-muted rounded animate-pulse" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                <div className="h-4 w-72 bg-muted rounded animate-pulse" />
              </div>
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
                <div className="mt-2 bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-2">
                  <p className="text-sm text-blue-400">This wallet already has a policy on-chain. Submitting a new one will replace it.</p>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 2: Policy Owner — skeleton while loading */}
      {loading && (
        <Card className="mb-6 animate-pulse">
          <CardContent className="p-6">
            <div className="flex items-center mb-4">
              <div className="w-6 h-6 rounded-full bg-muted mr-2" />
              <div className="h-5 w-28 bg-muted rounded" />
            </div>
            <div className="h-4 w-64 bg-muted rounded mb-4" />
            <div className="flex space-x-3">
              <div className="h-9 w-32 bg-muted rounded-lg" />
              <div className="h-9 w-36 bg-muted rounded-lg" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: skeleton while loading */}
      {loading && (
        <Card className="mb-6 animate-pulse">
          <CardContent className="p-6">
            <div className="flex items-center mb-4">
              <div className="w-6 h-6 rounded-full bg-muted mr-2" />
              <div className="h-5 w-32 bg-muted rounded" />
            </div>
            <div className="h-4 w-40 bg-muted rounded mb-3" />
            <div className="h-10 bg-muted rounded-lg" />
            <div className="h-10 bg-muted rounded-lg mt-2" />
            <div className="h-10 bg-muted rounded-lg mt-2" />
          </CardContent>
        </Card>
      )}

      {/* Step 2: Policy Owner */}
      {walletInfo && (
        <Card className="mb-6">
          <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs mr-2">2</span>
            Policy Owner
            </h2>

            <p className="text-sm text-muted-foreground mb-4">
              The owner can freeze the wallet, update the policy, and approve transactions.
            </p>

            <div className="flex space-x-3 mb-4">
              <button
                type="button"
                onClick={() => setOwnerMode('wallet')}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  ownerMode === 'wallet'
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-background text-muted-foreground border-border hover:border-muted-foreground'
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
                    : 'bg-background text-muted-foreground border-border hover:border-muted-foreground'
                }`}
              >
                Enter Account ID
              </button>
            </div>

            {ownerMode === 'wallet' ? (
              isNearConnected ? (
                <p className="text-sm text-lime-400">
                  Connected as <span className="font-mono font-medium">{nearAccountId}</span>
                </p>
              ) : (
                <div>
                  <Button onClick={requestNearLogin}>
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
                {manualOwner.trim() && !isNearConnected && (
                  <div className="mt-3">
                    <Button variant="outline" onClick={requestNearLogin}>
                      Connect wallet to sign transaction
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Set Policy — show skeleton while checking existing policy */}
      {walletInfo && ownerReady && existingPolicy === null && (
        <Card className="mb-6 animate-pulse">
          <CardContent className="p-6">
            <div className="flex items-center mb-4">
              <div className="w-6 h-6 rounded-full bg-muted mr-2" />
              <div className="h-5 w-32 bg-muted rounded" />
            </div>
            <div className="h-4 w-40 bg-muted rounded mb-4" />
            <div className="h-10 bg-muted rounded-lg" />
            <div className="h-10 bg-muted rounded-lg mt-2" />
          </CardContent>
        </Card>
      )}
      {walletInfo && ownerReady && existingPolicy !== null && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-6">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs mr-2">3</span>
              Set Spending Policy
            </h2>

            <div className="space-y-6">
              {/* Transaction Approval */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Transaction Approval</h3>

                {/* Toggle */}
                <div
                  className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                    requireApproval
                      ? 'border-lime-500/25 bg-lime-500/10'
                      : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <div
                    className="cursor-pointer"
                    onClick={() => setRequireApproval(!requireApproval)}
                  >
                    <p className={`font-medium ${requireApproval ? 'text-lime-400' : 'text-foreground'}`}>
                      Require personal approval
                    </p>
                    <p className={`text-sm mt-0.5 ${requireApproval ? 'text-lime-400/70' : 'text-muted-foreground'}`}>
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
                            <div className="w-2 h-2 rounded-full bg-lime-500 shrink-0" />
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
            <h2 className="text-lg font-semibold text-foreground mb-3">Next Steps</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to={`/wallet/approvals?key=${apiKey}`} className="text-foreground hover:underline font-medium">
                  Approvals
                </Link>
                {' '}&mdash; review and approve pending transactions
              </li>
              <li>
                <Link to={`/wallet/manage?key=${apiKey}`} className="text-foreground hover:underline font-medium">
                  Manage Wallets
                </Link>
                {' '}&mdash; edit policy, freeze wallet
              </li>
              <li>
                <Link to={`/wallet/audit?key=${apiKey}`} className="text-foreground hover:underline font-medium">
                  Audit Log
                </Link>
                {' '}&mdash; view transaction history
              </li>
            </ul>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
