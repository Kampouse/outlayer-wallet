/**
 * Outlayer SDK wrapper — thin layer that creates configured SDK instances
 * using the same network / base-URL logic as the rest of the app.
 */

import {
  OutlayerClient,
  NETWORK_BASE_URLS,
} from '@outlayer/sdk';

// Re-use the canonical NetworkType so consumers don't need two imports.
export type { NetworkType } from './api';

/**
 * Resolve the Coordinator API base URL for the given network.
 *
 * This is the *app-level* resolver that honours environment overrides
 * (`VITE_MAINNET_COORDINATOR_API_URL`, `VITE_TESTNET_COORDINATOR_API_URL`)
 * and falls back to the SDK's built-in `NETWORK_BASE_URLS` when no env var is set.
 *
 * It also consults localStorage for the current network when `network` is
 * not explicitly provided.
 */
export function getCoordinatorApiUrl(network?: 'testnet' | 'mainnet'): string {
  // Resolve current network (same logic as api.ts)
  let currentNetwork = network;
  if (!currentNetwork && typeof window !== 'undefined') {
    const stored = localStorage.getItem('near-wallet-selector:selectedNetworkId');
    if (stored === 'testnet' || stored === 'mainnet') {
      currentNetwork = stored;
    }
  }
  if (!currentNetwork) {
    currentNetwork = (import.meta.env.VITE_DEFAULT_NETWORK || 'mainnet') as 'testnet' | 'mainnet';
  }

  // Prefer env overrides; fall back to SDK defaults
  if (currentNetwork === 'mainnet') {
    return (
      import.meta.env.VITE_MAINNET_COORDINATOR_API_URL ||
      NETWORK_BASE_URLS.mainnet
    );
  }

  return (
    import.meta.env.VITE_TESTNET_COORDINATOR_API_URL ||
    NETWORK_BASE_URLS.testnet
  );
}

/**
 * Create an authenticated Outlayer SDK client.
 *
 * The client is pre-configured with the correct base URL for the requested
 * network (env overrides respected).
 */
/**
 * Custom fetch that strips headers not allowed by the coordinator's CORS policy.
 * The SDK adds `Idempotency-Key` to every write call, but the coordinator
 * doesn't include it in Access-Control-Allow-Headers → preflight fails.
 */
function corsSafeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.delete('Idempotency-Key');
    init = { ...init, headers: h };
  }
  return globalThis.fetch(input, init);
}

export function getOutlayerClient(
  apiKey: string,
  network?: 'testnet' | 'mainnet',
): OutlayerClient {
  const baseUrl = getCoordinatorApiUrl(network);

  return new OutlayerClient({
    apiKey,
    baseUrl,
    fetch: corsSafeFetch,
    network: network ?? (
      typeof window !== 'undefined'
        ? (localStorage.getItem('near-wallet-selector:selectedNetworkId') as 'testnet' | 'mainnet' | null) ??
          (import.meta.env.VITE_DEFAULT_NETWORK || 'mainnet') as 'testnet' | 'mainnet'
        : 'mainnet'
    ),
  });
}

/**
 * Create an unauthenticated Outlayer SDK client.
 *
 * Used for static calls like `OutlayerClient.register()` that don't
 * require an API key.
 */
export function getOutlayerUnauthenticated(
  network?: 'testnet' | 'mainnet',
) {
  const baseUrl = getCoordinatorApiUrl(network);
  const resolvedNetwork = network ?? (
    typeof window !== 'undefined'
      ? (localStorage.getItem('near-wallet-selector:selectedNetworkId') as 'testnet' | 'mainnet' | null) ??
        (import.meta.env.VITE_DEFAULT_NETWORK || 'mainnet') as 'testnet' | 'mainnet'
      : 'mainnet'
  );

  return {
    baseUrl,
    network: resolvedNetwork,
  };
}
