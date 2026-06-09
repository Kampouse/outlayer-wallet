import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNearWallet } from '@/contexts/NearWalletContext';
import WalletConnectionModal from '@/components/WalletConnectionModal';
import { actionCreators } from '@near-js/transactions';
import { getTransactionUrl } from '@/lib/explorer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Check, DollarSign } from 'lucide-react';
import { rpcQuery } from '@/lib/rpc-pool';

interface TokenMeta {
  symbol: string;
  decimals: number;
  icon: string | null;
}

/** Convert human-readable amount to yoctoNEAR string */
function nearToYocto(amount: string): string {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) throw new Error('Invalid amount');
  const yocto = BigInt(Math.round(parsed * 1e6)) * BigInt(1e18);
  return yocto.toString();
}

/** Convert human-readable amount to FT minimal units using decimals */
function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
  const result = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return result.toString();
}

/** Format yoctoNEAR to human-readable */
function formatYocto(yocto: string): string {
  const near = parseFloat(yocto) / 1e24;
  return near.toFixed(4);
}

/** Format FT minimal units to human-readable */
function formatFtAmount(minimal: string, decimals: number): string {
  if (!minimal || minimal === '0') return '0';
  const val = BigInt(minimal);
  const divisor = BigInt(10 ** decimals);
  const whole = val / divisor;
  const remainder = val % divisor;
  const fracStr = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/** Truncate a hex account for display */
function truncateAccount(account: string): string {
  if (account.length <= 20) return account;
  return `${account.slice(0, 10)}...${account.slice(-8)}`;
}

export default function FundPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><LoadingSpinner /></div>}>
      <FundContent />
    </Suspense>
  );
}

function FundContent() {
  const [searchParams] = useSearchParams();
  const { accountId, isConnected, signAndSendTransaction, viewMethod, network } = useNearWallet();

  const to = searchParams.get('to');
  const amount = searchParams.get('amount');
  const tokenParam = searchParams.get('token') || 'near';
  const msg = searchParams.get('msg');
  const destParam = searchParams.get('dest'); // "intents" = deposit to intents balance
  // via/method/args — custom contract call, native NEAR only
  const viaContract = searchParams.get('via');
  const viaMethod = searchParams.get('method') || 'deposit';
  const viaArgs = searchParams.get('args');
  const gasParam = searchParams.get('gas'); // TGas, default 30
  const gasTGas = BigInt(gasParam ? parseInt(gasParam, 10) : 30) * BigInt(1e12);
  const isNative = !tokenParam || tokenParam === 'near';
  const depositNearViaContract = isNative && !!viaContract;

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [tokenMeta, setTokenMeta] = useState<TokenMeta | null>(null);
  const [userBalance, setUserBalance] = useState<string | null>(null);
  const [needsStorage, setNeedsStorage] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Intents deposit toggle — for FT tokens, or native NEAR with a deposit helper contract
  const [depositToIntents, setDepositToIntents] = useState(destParam === 'intents');

  // Validate params
  if (!to || !amount) {
    return (
      <div className="max-w-lg mx-auto mt-12 px-4">
        <Card>
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
              <DollarSign className="w-6 h-6 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Fund a Wallet</h2>
            <p className="text-muted-foreground text-sm">
              This page is accessed via a funding link with a recipient address and amount.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return (
      <div className="max-w-lg mx-auto mt-12 px-4">
        <div className="bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-6">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Invalid Amount</h2>
          <p className="text-red-400 text-sm">Amount must be a positive number.</p>
        </div>
      </div>
    );
  }

  const viaError = viaContract && !isNative
    ? 'The "via" parameter is only supported for native NEAR transfers.'
    : null;

  // Fetch token metadata for FT tokens
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (isNative) {
      setTokenMeta({ symbol: 'NEAR', decimals: 24, icon: null });
      return;
    }
    (async () => {
      try {
        const meta = await viewMethod({ contractId: tokenParam, method: 'ft_metadata', args: {} }) as TokenMeta;
        setTokenMeta(meta);
      } catch {
        setError(`Failed to fetch token metadata for ${tokenParam}`);
      }
    })();
  }, [isNative, tokenParam, viewMethod]);

  // Fetch user balance + storage check when connected
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fetchBalances = useCallback(async () => {
    if (!isConnected || !accountId) return;
    setError(null);

    try {
      if (isNative) {
        // Fetch native NEAR balance via pool (circuit breaker + dedup)
        const data = await rpcQuery<{ amount: string }>(
          network,
          'query',
          { request_type: 'view_account', finality: 'final', account_id: accountId },
          { cacheTtlMs: 8_000 },
        );
        setUserBalance(data?.amount ?? '0');
      } else {
        // FT: check user balance
        const bal = await viewMethod({
          contractId: tokenParam,
          method: 'ft_balance_of',
          args: { account_id: accountId },
        }) as string;
        setUserBalance(bal || '0');

        // Check if receiver needs storage registration on token contract
        // When depositing to intents, the receiver is intents.near (not the agent)
        const storageTarget = depositToIntents ? 'intents.near' : to;
        const storage = await viewMethod({
          contractId: tokenParam,
          method: 'storage_balance_of',
          args: { account_id: storageTarget },
        });
        setNeedsStorage(!storage);
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(`Failed to check balances: ${errMsg}`);
    }
  }, [isConnected, accountId, isNative, network, tokenParam, to, viewMethod, depositToIntents]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const symbol = tokenMeta?.symbol || (isNative ? 'NEAR' : tokenParam);
  const decimals = tokenMeta?.decimals ?? (isNative ? 24 : 0);

  // Check if user has enough balance
  const hasEnough = (() => {
    if (!userBalance || !decimals) return false;
    if (isNative) {
      try {
        const required = BigInt(nearToYocto(amount));
        const reserve = BigInt('50000000000000000000000'); // 0.05 NEAR reserve
        return BigInt(userBalance) >= required + reserve;
      } catch { return false; }
    } else {
      try {
        const required = BigInt(toMinimalUnits(amount, decimals));
        return BigInt(userBalance) >= required;
      } catch { return false; }
    }
  })();

  const handleSend = async () => {
    if (!to || !amount) return;
    setSending(true);
    setError(null);

    try {
      let result;

      if (depositNearViaContract) {
        // Native NEAR via custom contract call (e.g. wrap + deposit)
        const parsedArgs = viaArgs ? JSON.parse(viaArgs) : {};
        result = await signAndSendTransaction({
          receiverId: viaContract!,
          actions: [
            actionCreators.functionCall(
              viaMethod,
              parsedArgs,
              gasTGas,
              BigInt(nearToYocto(amount)),
            ),
          ],
        });
      } else if (isNative) {
        // Direct NEAR transfer
        const yoctoAmount = nearToYocto(amount);
        result = await signAndSendTransaction({
          receiverId: to,
          actions: [actionCreators.transfer(BigInt(yoctoAmount))],
        });
      } else {
        const minimalUnits = toMinimalUnits(amount, decimals);
        const actions = [];

        if (depositToIntents) {
          // Deposit to agent's intents balance via ft_transfer_call to intents.near
          // msg = agent account ID → intents.near credits the agent
          if (needsStorage) {
            actions.push(
              actionCreators.functionCall(
                'storage_deposit',
                { account_id: 'intents.near', registration_only: true },
                BigInt('30000000000000'), // 30 TGas
                BigInt('1250000000000000000000'), // 0.00125 NEAR
              ),
            );
          }

          actions.push(
            actionCreators.functionCall(
              'ft_transfer_call',
              { receiver_id: 'intents.near', amount: minimalUnits, msg: to },
              BigInt('100000000000000'), // 100 TGas
              BigInt('1'), // 1 yoctoNEAR
            ),
          );
        } else {
          // Direct FT transfer to agent account
          if (needsStorage) {
            actions.push(
              actionCreators.functionCall(
                'storage_deposit',
                { account_id: to, registration_only: true },
                BigInt('30000000000000'), // 30 TGas
                BigInt('1250000000000000000000'), // 0.00125 NEAR
              ),
            );
          }

          actions.push(
            actionCreators.functionCall(
              'ft_transfer',
              { receiver_id: to, amount: minimalUnits, memo: null },
              BigInt('30000000000000'), // 30 TGas
              BigInt('1'), // 1 yoctoNEAR
            ),
          );
        }

        result = await signAndSendTransaction({
          receiverId: tokenParam,
          actions,
        });
      }

      // Extract tx hash from result
      const hash = result?.transaction_outcome?.id
        || result?.transaction?.hash
        || (typeof result === 'string' ? result : null);
      if (hash) {
        setTxHash(hash);
      } else {
        setTxHash('submitted');
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (!errMsg.includes('User rejected') && !errMsg.includes('cancelled')) {
        setError(errMsg);
      }
    } finally {
      setSending(false);
    }
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(to);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Success state
  if (txHash) {
    return (
      <div className="max-w-lg mx-auto mt-12 px-4">
        <Card>
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 bg-lime-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-lime-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Transfer Complete</h2>
            <p className="text-muted-foreground mb-4">
              Sent {amount} {symbol} {depositNearViaContract
                ? `via ${viaContract}`
                : depositToIntents
                  ? 'to Intents balance'
                  : 'to recipient'}
            </p>
            {txHash !== 'submitted' && (
              <a
                href={getTransactionUrl(txHash, network)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline text-sm font-medium"
              >
                View transaction on explorer
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-12 px-4 pb-24">
      <Card>
        <CardContent className="p-6">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
              {tokenMeta?.icon ? (
                <img src={tokenMeta.icon} alt={symbol} className="w-8 h-8 rounded-full" />
              ) : (
                <DollarSign className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <h1 className="text-xl font-semibold text-foreground">Fund Request</h1>
            <p className="text-muted-foreground text-sm mt-1">You are requested to top up a wallet balance</p>
          </div>

          {/* Amount display */}
          <div className="bg-muted rounded-lg p-4 mb-4">
            <div className="text-center">
              <span className="text-3xl font-bold text-foreground">{amount}</span>
              <span className="text-xl text-muted-foreground ml-2">{symbol}</span>
            </div>
          </div>

          {/* Agent message */}
          {msg && (
            <div className="bg-blue-500/10 border-l-4 border-blue-500 rounded-r-lg p-3 mb-4">
              <p className="text-blue-800 text-sm">{msg}</p>
            </div>
          )}

          {/* Recipient */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Recipient</label>
            <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
              <span className="font-mono text-sm text-foreground flex-1 truncate">{truncateAccount(to)}</span>
              <button
                onClick={copyAddress}
                className="text-muted-foreground hover:text-foreground text-xs flex-shrink-0 font-medium"
                title="Copy full address"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* via error */}
          {viaError && (
            <div className="bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3 mb-4">
              <p className="text-red-800 text-sm">{viaError}</p>
            </div>
          )}

          {/* Intents deposit toggle — FT tokens only */}
          {!isNative && (
            <div className="mb-4">
              <label className="flex items-center justify-between bg-muted border border-border rounded-lg px-3 py-2.5 cursor-pointer">
                <div>
                  <span className="text-sm font-medium text-foreground">Deposit to Intents balance</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {depositToIntents
                      ? 'Funds go to Intents balance (swaps, payments)'
                      : 'Funds go directly to recipient\u2019s token account'}
                  </p>
                </div>
                <Checkbox
                  checked={depositToIntents}
                  onCheckedChange={(v) => setDepositToIntents(!!v)}
                />
              </label>
            </div>
          )}

          {/* Transaction details — show exactly what will be signed */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Transaction details</label>
            <div className="bg-muted border border-border rounded-lg p-3 space-y-1.5 text-xs font-mono text-muted-foreground">
              {depositNearViaContract ? (
                <>
                  <div><span className="text-muted-foreground">Contract:</span> {viaContract}</div>
                  <div><span className="text-muted-foreground">Method:</span> {viaMethod}</div>
                  {viaArgs && <div className="break-all"><span className="text-muted-foreground">Args:</span> {viaArgs}</div>}
                  <div><span className="text-muted-foreground">Deposit:</span> {amount} NEAR</div>
                  <div><span className="text-muted-foreground">Gas:</span> {gasParam || '30'} TGas</div>
                </>
              ) : isNative ? (
                <>
                  <div><span className="text-muted-foreground">Action:</span> Transfer</div>
                  <div><span className="text-muted-foreground">To:</span> {truncateAccount(to)}</div>
                  <div><span className="text-muted-foreground">Amount:</span> {amount} NEAR</div>
                </>
              ) : depositToIntents ? (
                <>
                  <div><span className="text-muted-foreground">Contract:</span> {tokenParam}</div>
                  <div><span className="text-muted-foreground">Method:</span> ft_transfer_call</div>
                  <div><span className="text-muted-foreground">Receiver:</span> intents.near</div>
                  <div><span className="text-muted-foreground">Amount:</span> {amount} {symbol}</div>
                  <div><span className="text-muted-foreground">Msg:</span> {truncateAccount(to)}</div>
                </>
              ) : (
                <>
                  <div><span className="text-muted-foreground">Contract:</span> {tokenParam}</div>
                  <div><span className="text-muted-foreground">Method:</span> ft_transfer</div>
                  <div><span className="text-muted-foreground">To:</span> {truncateAccount(to)}</div>
                  <div><span className="text-muted-foreground">Amount:</span> {amount} {symbol}</div>
                </>
              )}
            </div>
          </div>

          {/* Storage deposit notice */}
          {!isNative && needsStorage && (
            <div className="bg-amber-500/10 border-l-4 border-amber-500 rounded-r-lg p-3 mb-4">
              <p className="text-amber-800 text-sm">
                The recipient is not registered on this token contract. A one-time storage deposit of 0.00125 NEAR will be included automatically.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3 mb-4">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* Connect or Send */}
          {!isConnected ? (
            <Button
              onClick={() => setShowWalletModal(true)}
              className="w-full h-11"
            >
              Connect Wallet to Send
            </Button>
          ) : (
            <div>
              {/* Balance info */}
              {userBalance !== null && (
                <div className="text-sm text-muted-foreground mb-3">
                  Your balance:{' '}
                  <span className="font-mono font-medium text-foreground">
                    {isNative
                      ? `${formatYocto(userBalance)} NEAR`
                      : `${formatFtAmount(userBalance, decimals)} ${symbol}`}
                  </span>
                  {!hasEnough && (
                    <span className="text-red-400 ml-2">
                      (insufficient{isNative ? ', keep ~0.05 NEAR for fees' : ''})
                    </span>
                  )}
                </div>
              )}

              <Button
                onClick={handleSend}
                disabled={sending || !hasEnough || !tokenMeta || !!viaError}
                className="w-full h-11"
              >
                {sending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </span>
                ) : (
                  depositNearViaContract
                    ? `Send ${amount} NEAR via ${viaContract}`
                    : depositToIntents
                      ? `Deposit ${amount} ${symbol} to Intents`
                      : `Send ${amount} ${symbol}`
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center mt-2">
                Connected as {accountId}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <WalletConnectionModal isOpen={showWalletModal} onClose={() => setShowWalletModal(false)} />
    </div>
  );
}

function LoadingSpinner({ small }: { small?: boolean }) {
  const size = small ? 'h-4 w-4' : 'h-8 w-8';
  return (
    <Loader2 className={`animate-spin ${size} text-muted-foreground`} />
  );
}