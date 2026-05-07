import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AuthorizedKeysSectionProps {
  additionalKeyHashes: string[];
  onChangeHashes: (hashes: string[]) => void;
  apiKeyHash?: string;
  knownKeyHashes?: Map<string, string>;
  onSaveKey?: (apiKey: string) => void;
}

export function AuthorizedKeysSection({
  additionalKeyHashes,
  onChangeHashes,
  apiKeyHash,
  knownKeyHashes,
  onSaveKey,
}: AuthorizedKeysSectionProps) {
  const [newHash, setNewHash] = useState('');
  const [expanded, setExpanded] = useState(false);

  const addHash = () => {
    const h = newHash.trim();
    if (h && !additionalKeyHashes.includes(h)) {
      onChangeHashes([...additionalKeyHashes, h]);
      setNewHash('');
    }
  };

  const removeHash = (index: number) => {
    onChangeHashes(additionalKeyHashes.filter((_, i) => i !== index));
  };

  const labelForHash = (hash: string): string | null => {
    if (apiKeyHash && hash === apiKeyHash) return 'current handoff key';
    if (knownKeyHashes?.has(hash)) return knownKeyHashes.get(hash)!;
    return null;
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-sm text-zinc-900 hover:text-zinc-600 font-medium"
      >
        <span className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        Authorized API Keys
        {apiKeyHash && (
          <span className="ml-1.5 text-xs bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded">
            {additionalKeyHashes.length + 1} total
          </span>
        )}
      </button>

      {!expanded ? (
        <p className="text-xs text-zinc-400 mt-1 ml-5">
          {apiKeyHash
            ? '1 key auto-included (current handoff key)'
            : 'No keys configured'}
          {additionalKeyHashes.length > 0 && ` + ${additionalKeyHashes.length} additional`}
        </p>
      ) : (
        <div className="mt-2 ml-5 space-y-3">
          {/* Auto-included key (read-only) */}
          {apiKeyHash && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-800">
                    Current handoff key
                    <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">auto-included</span>
                  </p>
                  <p className="text-xs text-emerald-600 font-mono mt-1 break-all">{apiKeyHash}</p>
                </div>
              </div>
              <p className="text-xs text-emerald-600/70 mt-2">
                This is the SHA-256 hash of your current handoff API key. It will always be included in the policy.
              </p>
            </div>
          )}

          {/* Additional keys */}
          {additionalKeyHashes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 font-medium">Additional authorized keys:</p>
              {additionalKeyHashes.map((hash, i) => {
                const label = labelForHash(hash);
                return (
                  <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        {label && (
                          <p className="text-xs text-zinc-500">{label}</p>
                        )}
                        <p className="text-xs font-mono text-zinc-700 break-all">{hash}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeHash(i)}
                        className="text-xs text-red-500 hover:text-red-700 flex-shrink-0 ml-2"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add new hash */}
          <div>
            <p className="text-xs text-zinc-500 mb-1">Add an API key hash:</p>
            <div className="flex gap-2">
              <Input
                type="text"
                value={newHash}
                onChange={(e) => setNewHash(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addHash();
                }}
                placeholder="SHA-256 hash of API key"
                className="font-mono text-xs"
              />
              <Button
                onClick={addHash}
                disabled={!newHash.trim()}
                variant="outline"
                size="sm"
              >
                Add
              </Button>
            </div>
          </div>

          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
            <p className="text-xs text-zinc-500">
              Only API keys whose SHA-256 hash is listed here will be accepted by the wallet.
              The coordinator stores your key and sends it with requests; it never appears on-chain.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
