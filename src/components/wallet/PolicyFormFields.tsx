import { useState } from 'react';
import { PolicyForm } from '@/lib/wallet-policy';
import { AuthorizedKeysSection } from './AuthorizedKeysSection';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Info } from 'lucide-react';

interface PolicyFormFieldsProps {
  policyForm: PolicyForm;
  onChange: (form: PolicyForm) => void;
  /** SHA256 hash of the current API key (auto-included, shown as read-only) */
  apiKeyHash?: string;
  /** Map of hash → label for hashes we can identify (from localStorage etc.) */
  knownKeyHashes?: Map<string, string>;
  /** Callback to save a generated/entered key to localStorage */
  onSaveKey?: (apiKey: string) => void;
}

export function PolicyFormFields({ policyForm, onChange, apiKeyHash, knownKeyHashes, onSaveKey }: PolicyFormFieldsProps) {
  const update = (patch: Partial<PolicyForm>) => onChange({ ...policyForm, ...patch });
  const [showWebhookInfo, setShowWebhookInfo] = useState(false);

  return (
    <div className="space-y-4">
      {/* Spending Limits */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Spending Limits</h3>
        <p className="text-xs text-muted-foreground mb-3">Native NEAR only. Leave empty for no limit. For token-specific limits, use the JSON editor.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Per-Transaction</label>
            <Input
              type="text"
              value={policyForm.per_transaction_limit}
              onChange={(e) => update({ per_transaction_limit: e.target.value })}
              placeholder="e.g. 10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Hourly</label>
            <Input
              type="text"
              value={policyForm.hourly_limit}
              onChange={(e) => update({ hourly_limit: e.target.value })}
              placeholder="e.g. 50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Daily</label>
            <Input
              type="text"
              value={policyForm.daily_limit}
              onChange={(e) => update({ daily_limit: e.target.value })}
              placeholder="e.g. 100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Monthly</label>
            <Input
              type="text"
              value={policyForm.monthly_limit}
              onChange={(e) => update({ monthly_limit: e.target.value })}
              placeholder="e.g. 1000"
            />
          </div>
        </div>
      </div>

      {/* Address Restrictions */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Address Restrictions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Restrict which accounts the wallet can interact with.</p>
        </div>
        <div className="p-4">
          <div className="flex rounded-lg border border-border p-0.5 bg-muted mb-3">
            {([
              { mode: 'none' as const, label: 'None' },
              { mode: 'whitelist' as const, label: 'Whitelist' },
              { mode: 'blacklist' as const, label: 'Blacklist' },
            ]).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => update({ address_mode: mode })}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  policyForm.address_mode === mode
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {policyForm.address_mode !== 'none' && (
            <Input
              type="text"
              value={policyForm.addresses}
              onChange={(e) => update({ addresses: e.target.value })}
              placeholder="bob.near, alice.near (comma-separated)"
            />
          )}
        </div>
      </div>

      {/* Allowed Tokens & Transaction Types */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Allowed Tokens &amp; Types</h3>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Allowed Tokens</label>
            <Input
              type="text"
              value={policyForm.allowed_tokens}
              onChange={(e) => update({ allowed_tokens: e.target.value })}
              placeholder="* for all, or: native, nep141:usdt..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Allowed Transaction Types</label>
            {(() => {
              const txTypeLabels: Record<string, { label: string; desc: string }> = {
                transfer: { label: 'Transfer', desc: 'Send native token' },
                call: { label: 'Contract call', desc: 'Smart contract interaction' },
                delete: { label: 'Delete wallet', desc: 'Remove the wallet' },
                intents_withdraw: { label: 'Cross-chain', desc: 'Send via NEAR Intents' },
                intents_swap: { label: 'Swap', desc: 'Token swap via Intents' },
                intents_deposit: { label: 'Deposit', desc: 'Deposit to Intents' },
              };
              const types = policyForm.transaction_types.split(',').map((t) => t.trim()).filter(Boolean);
              const renderToggle = (txType: string) => {
                const info = txTypeLabels[txType];
                const checked = types.includes(txType);
                return (
                  <div
                    key={txType}
                    className={`flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-muted ${
                      txType === 'intents_withdraw' ? 'border-t border-border' : ''
                    }`}
                  >
                    <div
                      className="min-w-0 cursor-pointer"
                      onClick={() => {
                        const next = checked ? types.filter((t: string) => t !== txType) : [...types, txType];
                        update({ transaction_types: next.join(',') });
                      }}
                    >
                      <p className={`text-sm font-medium ${checked ? 'text-foreground' : 'text-muted-foreground'}`}>{info.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{info.desc}</p>
                    </div>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        const next = v ? [...types, txType] : types.filter((t: string) => t !== txType);
                        update({ transaction_types: next.join(',') });
                      }}
                    />
                  </div>
                );
              };
              return (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {['transfer', 'call', 'delete'].map(renderToggle)}
                  <div className="px-4 py-1.5 bg-muted/50">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">NEAR Intents</span>
                  </div>
                  {['intents_withdraw', 'intents_swap', 'intents_deposit'].map(renderToggle)}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Time Restrictions */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Time Restrictions <span className="text-muted-foreground font-normal">(UTC)</span></h3>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Allowed Hours Start</label>
            <Input
              type="number"
              min="0"
              max="23"
              value={policyForm.allowed_hours_start}
              onChange={(e) => update({ allowed_hours_start: e.target.value })}
              placeholder="9"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Allowed Hours End</label>
            <Input
              type="number"
              min="0"
              max="24"
              value={policyForm.allowed_hours_end}
              onChange={(e) => update({ allowed_hours_end: e.target.value })}
              placeholder="17"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Allowed Days</label>
            <Input
              type="text"
              value={policyForm.allowed_days}
              onChange={(e) => update({ allowed_days: e.target.value })}
              placeholder="1,2,3,4,5 (Mon-Fri)"
            />
            <p className="text-xs text-muted-foreground mt-1">1=Mon ... 7=Sun</p>
          </div>
          </div>
        </div>
      </div>

      {/* Rate Limit & Webhook */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Rate Limit &amp; Webhook</h3>
        </div>
        <div className="p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Max Transactions per Hour</label>
          <Input
            type="number"
            value={policyForm.max_per_hour}
            onChange={(e) => update({ max_per_hour: e.target.value })}
            placeholder="e.g. 10"
          />
          <p className="text-xs text-muted-foreground mt-1">Counts all operation types including intents deposit and swap.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Webhook URL
            <Info
              className="ml-1.5 inline w-3.5 h-3.5 text-muted-foreground cursor-pointer hover:text-muted-foreground align-middle"
              onClick={() => setShowWebhookInfo((v) => !v)}
            />
            {showWebhookInfo && (
              <span className="block mt-1 text-xs font-normal text-muted-foreground">
                Receive POST notifications on transaction events (approval_needed, approval_received, request_completed).
                Must be HTTPS. Requests include HMAC-SHA256 signature for verification. Failed deliveries are retried up to 3 times.
              </span>
            )}
          </label>
          <Input
            type="text"
            value={policyForm.webhook_url}
            onChange={(e) => update({ webhook_url: e.target.value })}
            placeholder="https://..."
          />
        </div>
        </div>
      </div>

      {/* Authorized API Keys */}
      <AuthorizedKeysSection
        additionalKeyHashes={policyForm.additional_key_hashes.split('\n').filter(Boolean)}
        onChangeHashes={(hashes) => update({ additional_key_hashes: hashes.join('\n') })}
        apiKeyHash={apiKeyHash}
        knownKeyHashes={knownKeyHashes}
        onSaveKey={onSaveKey}
      />

      {/* Signing Capabilities */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Signing Capabilities</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Control which chains and signing primitives the wallet can use. Default-DENY under a policy.</p>
        </div>
        <div className="divide-y divide-border">
          {/* Solana */}
          <div className="px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Solana</p>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="cursor-pointer" onClick={() => update({ cap_solana_sign_allowed: !policyForm.cap_solana_sign_allowed })}>
              <p className={`text-sm font-medium ${policyForm.cap_solana_sign_allowed ? 'text-foreground' : 'text-muted-foreground'}`}>Sign Transactions</p>
              <p className="text-xs text-muted-foreground">Solana tx message signing (max 1232 bytes)</p>
            </div>
            <Checkbox
              checked={policyForm.cap_solana_sign_allowed}
              onCheckedChange={(v) => update({ cap_solana_sign_allowed: !!v })}
            />
          </div>
          {policyForm.cap_solana_sign_allowed && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
              <div className="cursor-pointer" onClick={() => update({ cap_solana_sign_raw_tx: !policyForm.cap_solana_sign_raw_tx })}>
                <p className={`text-sm font-medium ${policyForm.cap_solana_sign_raw_tx ? 'text-foreground' : 'text-muted-foreground'}`}>Raw TX Mode</p>
                <p className="text-xs text-muted-foreground">Sign arbitrary message bytes (not parsed txs)</p>
              </div>
              <Checkbox
                checked={policyForm.cap_solana_sign_raw_tx}
                onCheckedChange={(v) => update({ cap_solana_sign_raw_tx: !!v })}
              />
            </div>
          )}

          {/* EVM */}
          <div className="px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">EVM <span className="font-normal">(ETH, Polygon, Base, Arb, OP, BSC, AVAX)</span></p>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="cursor-pointer" onClick={() => update({ cap_evm_sign_allowed: !policyForm.cap_evm_sign_allowed })}>
              <p className={`text-sm font-medium ${policyForm.cap_evm_sign_allowed ? 'text-foreground' : 'text-muted-foreground'}`}>EVM Signing</p>
              <p className="text-xs text-muted-foreground">EIP-712 typed-data, personal_sign, raw tx</p>
            </div>
            <Checkbox
              checked={policyForm.cap_evm_sign_allowed}
              onCheckedChange={(v) => update({ cap_evm_sign_allowed: !!v })}
            />
          </div>

          {/* Raw Sign */}
          <div className="px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Raw Signing</p>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="cursor-pointer" onClick={() => update({ cap_raw_sign_allowed: !policyForm.cap_raw_sign_allowed })}>
              <p className={`text-sm font-medium ${policyForm.cap_raw_sign_allowed ? 'text-foreground' : 'text-muted-foreground'}`}>Raw Sign</p>
              <p className="text-xs text-muted-foreground">Sign arbitrary bytes (dangerous)</p>
            </div>
            <Checkbox
              checked={policyForm.cap_raw_sign_allowed}
              onCheckedChange={(v) => update({ cap_raw_sign_allowed: !!v })}
            />
          </div>
          {policyForm.cap_raw_sign_allowed && (
            <div className="px-4 py-2.5 bg-muted/30">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Chain Allowlist (empty = all)</label>
              <Input
                type="text"
                value={policyForm.cap_raw_sign_chains}
                onChange={(e) => update({ cap_raw_sign_chains: e.target.value })}
                placeholder="solana, ethereum, near"
              />
            </div>
          )}

          {/* Other */}
          <div className="px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Other</p>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="cursor-pointer" onClick={() => update({ cap_sign_message_allowed: !policyForm.cap_sign_message_allowed })}>
              <p className={`text-sm font-medium ${policyForm.cap_sign_message_allowed ? 'text-foreground' : 'text-muted-foreground'}`}>Sign Message</p>
              <p className="text-xs text-muted-foreground">NEP-413 dApp login (default: allowed)</p>
            </div>
            <Checkbox
              checked={policyForm.cap_sign_message_allowed}
              onCheckedChange={(v) => update({ cap_sign_message_allowed: !!v })}
            />
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="cursor-pointer" onClick={() => update({ cap_confidential_allowed: !policyForm.cap_confidential_allowed })}>
              <p className={`text-sm font-medium ${policyForm.cap_confidential_allowed ? 'text-foreground' : 'text-muted-foreground'}`}>Confidential</p>
              <p className="text-xs text-muted-foreground">Confidential / unlockable transfers</p>
            </div>
            <Checkbox
              checked={policyForm.cap_confidential_allowed}
              onCheckedChange={(v) => update({ cap_confidential_allowed: !!v })}
            />
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="cursor-pointer" onClick={() => update({ cap_swap_allowed: !policyForm.cap_swap_allowed })}>
              <p className={`text-sm font-medium ${policyForm.cap_swap_allowed ? 'text-foreground' : 'text-muted-foreground'}`}>Swap</p>
              <p className="text-xs text-muted-foreground">Token swap capability</p>
            </div>
            <Checkbox
              checked={policyForm.cap_swap_allowed}
              onCheckedChange={(v) => update({ cap_swap_allowed: !!v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
