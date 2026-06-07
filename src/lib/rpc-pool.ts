/**
 * Smart NEAR RPC pool with circuit breaker + request coalescing + TTL cache.
 *
 * Solves 429 rate-limit issues by:
 *  1. Spreading calls across many free public RPC endpoints
 *  2. Backing off endpoints that return 429/503 (exponential, max 5 min)
 *  3. Coalescing duplicate in-flight requests into one fetch
 *  4. Short-lived success cache (default 8 s) so simultaneous callers share
 *
 * Public endpoint list pulled from https://docs.near.org/api/rpc/providers
 */

export type NetworkType = "testnet" | "mainnet";

interface EndpointState {
  url: string;
  /** 0 = healthy; epoch ms until allowed again */
  coolingUntil: number;
  /** Used for exponential backoff scaling */
  consecutive429: number;
  /** Round-robin within the healthy pool (oldest first) */
  lastUsed: number;
  successCount: number;
  failCount: number;
}

const MAINNET_ENDPOINTS = [
  "https://free.rpc.fastnear.com",
  "https://1rpc.io/near",
  "https://near.drpc.org",
  "https://near.lava.build",
  "https://rpc.ankr.com/near",
  "https://endpoints.omniatech.io/v1/near/mainnet/public",
  "https://rpc.mainnet.near.org",
];

const TESTNET_ENDPOINTS = [
  "https://test.rpc.fastnear.com",
  "https://rpc.testnet.near.org",
  "https://near-testnet.lava.build",
];

const states = new Map<NetworkType, EndpointState[]>();

function getStates(network: NetworkType): EndpointState[] {
  let arr = states.get(network);
  if (!arr) {
    const urls = network === "mainnet" ? MAINNET_ENDPOINTS : TESTNET_ENDPOINTS;
    arr = urls.map((url) => ({
      url,
      coolingUntil: 0,
      consecutive429: 0,
      lastUsed: 0,
      successCount: 0,
      failCount: 0,
    }));
    states.set(network, arr);
  }
  return arr;
}

function pickEndpoint(network: NetworkType): EndpointState {
  const now = Date.now();
  const arr = getStates(network);
  const healthy = arr.filter((s) => s.coolingUntil <= now);
  // All cooling -> return the one closest to recovery
  const pool = healthy.length > 0 ? healthy : arr;
  pool.sort((a, b) => a.coolingUntil - b.coolingUntil || a.lastUsed - b.lastUsed);
  return pool[0];
}

function markSuccess(s: EndpointState) {
  s.consecutive429 = 0;
  s.coolingUntil = 0;
  s.successCount++;
}

function markFailure(s: EndpointState, status: number) {
  s.failCount++;
  if (status === 429 || status === 503) {
    // Exponential backoff: 20 s, 40 s, 80 s, 160 s, cap 300 s
    s.consecutive429++;
    const backoffMs = Math.min(20_000 * 2 ** (s.consecutive429 - 1), 300_000);
    s.coolingUntil = Date.now() + backoffMs;
  } else if (status > 0) {
    // Other HTTP error - brief cooldown
    s.coolingUntil = Date.now() + 5_000;
  } else {
    // Network/timeout - very brief cooldown
    s.coolingUntil = Date.now() + 2_000;
  }
}

// ── Coalescing + cache ────────────────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { value: unknown; expires: number }>();

function rpcKey(network: NetworkType, method: string, params: unknown): string {
  return `${network}:${method}:${JSON.stringify(params)}`;
}

export interface RpcOptions {
  /** Success cache TTL in ms. Set 0 to disable. Default 8_000. */
  cacheTtlMs?: number;
  /** Per-attempt timeout. Default 6_000. */
  timeoutMs?: number;
  /** Coalesce parallel identical requests. Default true. */
  coalesce?: boolean;
}

/**
 * Send a single JSON-RPC POST to the pool, with circuit breaker and dedup.
 *
 * NOTE: caller is responsible for decoding `result.result` (call_function
 * returns `{ result: number[] }`, view_account returns `{ amount, ... }`,
 * etc.).
 */
export async function rpcQuery<T = unknown>(
  network: NetworkType,
  method: string,
  params: unknown,
  opts: RpcOptions = {},
): Promise<T> {
  const key = rpcKey(network, method, params);
  const ttl = opts.cacheTtlMs ?? 8_000;
  const useCoalesce = opts.coalesce ?? true;

  // 1. Cache
  if (ttl > 0) {
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.value as T;
    }
  }

  // 2. In-flight dedup
  if (useCoalesce) {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;
  }

  const promise = doRpcQuery<T>(network, method, params, opts.timeoutMs ?? 6_000);
  if (useCoalesce) {
    inflight.set(key, promise);
    promise.finally(() => {
      // Only delete if it's still ours (no race in practice - JS is single-threaded)
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  }

  const result = await promise;
  if (ttl > 0) {
    cache.set(key, { value: result, expires: Date.now() + ttl });
  }
  return result;
}

async function doRpcQuery<T>(
  network: NetworkType,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<T> {
  const endpoints = getStates(network);
  let lastError: Error | null = null;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = pickEndpoint(network);
    ep.lastUsed = Date.now();

    try {
      const resp = await fetch(ep.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (resp.status === 429 || resp.status === 503) {
        markFailure(ep, resp.status);
        lastError = new Error(`RPC ${ep.url} rate limited (${resp.status})`);
        continue;
      }
      if (!resp.ok) {
        markFailure(ep, resp.status);
        lastError = new Error(`RPC ${ep.url} HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      if (data.error) {
        // App-level error from the RPC - the endpoint worked, our query was bad.
        // Bubble up immediately, don't retry on other endpoints.
        throw new Error(data.error.message || "RPC error");
      }

      markSuccess(ep);
      return data.result as T;
    } catch (e) {
      if (e instanceof Error && e.message.includes("rate limited")) {
        lastError = e;
        continue;
      }
      if (e instanceof Error && (e.message === "RPC error" || e.message.startsWith("RPC error"))) {
        throw e; // app-level
      }
      // Network/timeout
      markFailure(ep, 0);
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error("All RPC endpoints failed");
}

/** Debug snapshot of pool health. */
export function getPoolHealth(network: NetworkType) {
  const now = Date.now();
  return getStates(network).map((s) => ({
    url: s.url,
    cooling: s.coolingUntil > now,
    coolingMs: Math.max(0, s.coolingUntil - now),
    consecutive429: s.consecutive429,
    success: s.successCount,
    fail: s.failCount,
  }));
}

/** Clear cache + reset circuit breakers (debug). */
export function resetPool() {
  for (const arr of states.values()) {
    for (const s of arr) {
      s.coolingUntil = 0;
      s.consecutive429 = 0;
    }
  }
  cache.clear();
}
