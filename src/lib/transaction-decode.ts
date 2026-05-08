/**
 * Decode raw audit event details into human-readable transaction labels.
 * Maps token IDs to symbols, formats amounts with decimals.
 */

import type { SupportedToken } from '@/lib/api';

export interface DecodedTransaction {
  description: string;
  amount: string | null;
  symbol: string | null;
  icon: 'withdraw' | 'withdraw_pending' | 'deposit' | 'policy' | 'freeze' | 'unfreeze' | 'approval' | 'unknown';
}

/**
 * Find a token symbol by matching against various token ID formats.
 * Handles: "nep141:<contract>", "1cs_v1:<assetId>", or bare contract names.
 */
function findTokenSymbol(
  rawToken: unknown,
  catalog: SupportedToken[],
): { symbol: string; decimals: number } | null {
  if (!rawToken || typeof rawToken !== 'string') return null;

  const raw = rawToken.trim();

  // Direct match on defuse_asset_id or id
  let found = catalog.find(
    (t) => t.defuse_asset_id === raw || t.id === raw,
  );
  if (found) return { symbol: found.symbol, decimals: found.decimals };

  // Strip nep141: prefix and match on contract name
  if (raw.startsWith('nep141:')) {
    const contract = raw.slice(7);
    found = catalog.find(
      (t) =>
        t.defuse_asset_id === contract ||
        t.defuse_asset_id === raw ||
        t.id === contract,
    );
    if (found) return { symbol: found.symbol, decimals: found.decimals };
  }

  // Strip 1cs_v1: prefix
  if (raw.startsWith('1cs_v1:')) {
    const assetId = raw.slice(7);
    found = catalog.find(
      (t) => t.defuse_asset_id === assetId || t.id === assetId,
    );
    if (found) return { symbol: found.symbol, decimals: found.decimals };
  }

  return null;
}

/**
 * Format a raw amount string using token decimals.
 * e.g. "3863521" with 6 decimals → "3.863521"
 */
function formatAmount(rawAmount: unknown, decimals: number): string | null {
  if (rawAmount === null || rawAmount === undefined) return null;
  const str = String(rawAmount).trim();
  if (!str || !/^\d+$/.test(str)) return null;

  if (decimals === 0) return str;

  // Pad left with zeros to ensure we have enough digits
  const padded = str.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const decPart = padded.slice(padded.length - decimals);

  // Remove trailing zeros from decimal part
  const trimmed = decPart.replace(/0+$/, '');
  if (trimmed === '') return intPart;
  return `${intPart}.${trimmed}`;
}

export function decodeTransactionDetails(
  details: Record<string, unknown> | null | undefined,
  eventType: string,
  tokenCatalog: SupportedToken[],
): DecodedTransaction {
  const d = details ?? {};
  // Withdraw variants
  if (
    eventType === 'withdraw' ||
    eventType === 'withdraw_pending_approval' ||
    eventType === 'withdraw_auto_executed'
  ) {
    const tokenInfo = findTokenSymbol(d.token, tokenCatalog);
    const amount = tokenInfo
      ? formatAmount(d.amount, tokenInfo.decimals)
      : null;

    if (tokenInfo && amount) {
      return {
        description: `Withdraw ${tokenInfo.symbol}`,
        amount,
        symbol: tokenInfo.symbol,
        icon: eventType === 'withdraw_pending_approval' ? 'withdraw_pending' : 'withdraw',
      };
    }

    // Check if it's NEAR (no token field, just amount)
    const nearAmount = d.amount ? formatAmount(d.amount, 24) : null;
    if (nearAmount) {
      // NEAR has 24 decimals — convert to human-readable
      const nearNum = Number(nearAmount);
      const nearFormatted = (nearNum / 1e18).toFixed(6).replace(/\.?0+$/, '');
      return {
        description: 'Withdraw NEAR',
        amount: nearFormatted,
        symbol: 'NEAR',
        icon: eventType === 'withdraw_pending_approval' ? 'withdraw_pending' : 'withdraw',
      };
    }

    return {
      description: 'Withdraw',
      amount: d.amount ? String(d.amount) : null,
      symbol: tokenInfo?.symbol ?? null,
      icon: eventType === 'withdraw_pending_approval' ? 'withdraw_pending' : 'withdraw',
    };
  }

  // Deposit
  if (eventType === 'deposit') {
    const tokenInfo = findTokenSymbol(d.token, tokenCatalog);
    const amount = tokenInfo
      ? formatAmount(d.amount, tokenInfo.decimals)
      : null;

    if (tokenInfo && amount) {
      return {
        description: `Deposit ${tokenInfo.symbol}`,
        amount,
        symbol: tokenInfo.symbol,
        icon: 'deposit',
      };
    }

    return {
      description: 'Deposit',
      amount: d.amount ? String(d.amount) : null,
      symbol: tokenInfo?.symbol ?? null,
      icon: 'deposit',
    };
  }

  // Policy change
  if (eventType === 'policy_change') {
    return {
      description: 'Policy Updated',
      amount: null,
      symbol: null,
      icon: 'policy',
    };
  }

  // Freeze
  if (eventType === 'freeze') {
    return {
      description: 'Wallet Frozen',
      amount: null,
      symbol: null,
      icon: 'freeze',
    };
  }

  // Unfreeze
  if (eventType === 'unfreeze') {
    return {
      description: 'Wallet Unfrozen',
      amount: null,
      symbol: null,
      icon: 'unfreeze',
    };
  }

  // Approval
  if (eventType === 'approval') {
    const reqId = d.request_id ?? d.id ?? null;
    const suffix = reqId ? ` #${String(reqId).substring(0, 8)}` : '';
    return {
      description: `Approval${suffix}`,
      amount: null,
      symbol: null,
      icon: 'approval',
    };
  }

  // Unknown
  return {
    description: eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    amount: d.amount ? String(d.amount) : null,
    symbol: null,
    icon: 'unknown',
  };
}

/**
 * Format a timestamp as a relative time string.
 * Returns "Xm ago", "Xh ago", etc. for recent events,
 * or an absolute date string for older events.
 */
export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return new Date(dateStr).toLocaleDateString();

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  // For older events, show absolute date
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(dateStr).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}
