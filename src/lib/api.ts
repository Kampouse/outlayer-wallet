/**
 * API Client for OffchainVM Coordinator
 */

import axios from 'axios';

/** Wallet API base URL (CF Worker backend) */
export const WALLET_API_URL = import.meta.env.VITE_WALLET_API_URL || 'https://wallet-api.kj95hgdgnn.workers.dev';

export type NetworkType = 'testnet' | 'mainnet';

/**
 * Whether testnet worker infrastructure is currently online.
 * Set NEXT_PUBLIC_TESTNET_WORKERS_ENABLED=false to disable.
 */
export function isTestnetWorkersEnabled(): boolean {
  return import.meta.env.VITE_TESTNET_WORKERS_ENABLED !== 'false';
}

/**
 * Get Coordinator API base URL for the given network
 */
export function getCoordinatorApiUrl(network?: NetworkType): string {
  // Try to get network from localStorage if not provided
  let currentNetwork = network;
  if (!currentNetwork && typeof window !== 'undefined') {
    const stored = localStorage.getItem('near-wallet-selector:selectedNetworkId');
    if (stored === 'testnet' || stored === 'mainnet') {
      currentNetwork = stored;
    }
  }

  // Fallback to default network from env
  if (!currentNetwork) {
    currentNetwork = (import.meta.env.VITE_DEFAULT_NETWORK || 'mainnet') as NetworkType;
  }

  if (currentNetwork === 'mainnet') {
    return import.meta.env.VITE_MAINNET_COORDINATOR_API_URL || 'https://api.outlayer.fastnear.com';
  }

  return import.meta.env.VITE_TESTNET_COORDINATOR_API_URL || 'https://testnet-api.outlayer.fastnear.com';
}

// Always call getCoordinatorApiUrl() at request time — never cache it.
// Network can change at runtime via the NetworkSwitcher, and a module-load
// constant would silently keep hitting the previous network.

export interface WorkerInfo {
  worker_id: string;
  worker_name: string;
  status: string;
  current_task_id: number | null;
  last_heartbeat_at: string;
  total_tasks_completed: number;
  total_tasks_failed: number;
  uptime_seconds: number | null;
}

export interface JobHistoryEntry {
  id: number;
  job_id: number | null;
  request_id: number;
  data_id: string | null;
  worker_id: string;
  success: boolean;
  status: string | null; // job status (completed, failed, access_denied, etc.)
  error_details: string | null; // detailed error message
  job_type: string | null;
  execution_time_ms: number | null;
  compile_time_ms: number | null;
  instructions_used: number | null;
  resolve_tx_id: string | null;
  user_account_id: string | null;
  near_payment_yocto: string | null;
  actual_cost_yocto: string | null;
  compile_cost_yocto: string | null;
  github_repo: string | null;
  github_commit: string | null;
  transaction_hash: string | null;
  created_at: string;
  // HTTPS call fields
  is_https_call: boolean;
  call_id: string | null;
  // Project info
  project_id: string | null;
  // HTTPS cost in USD (stablecoin minimal units, 6 decimals)
  compute_cost_usd: string | null;
}

export interface ExecutionStats {
  total_executions: number;
  successful_executions: number;
  failed_executions: number; // Infrastructure errors only
  access_denied_executions: number;
  compilation_failed_executions: number;
  execution_failed_executions: number;
  insufficient_payment_executions: number;
  custom_executions: number;
  total_instructions_used: number;
  average_execution_time_ms: number;
  total_near_paid_yocto: string;
  unique_users: number;
  active_workers: number;
}

export interface WasmInfo {
  exists: boolean;
  checksum: string | null;
  file_size: number | null;
  created_at: string | null;
}

export interface UserEarnings {
  user_account_id: string;
  total_executions: number;
  successful_executions: number;
  total_near_spent_yocto: string;
  total_instructions_used: number;
  average_execution_time_ms: number;
}

export interface PopularRepo {
  github_repo: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number; // Infrastructure errors only
  access_denied_executions: number;
  compilation_failed_executions: number;
  execution_failed_executions: number;
  insufficient_payment_executions: number;
  custom_executions: number;
  last_commit: string | null;
}

export interface PricingConfig {
  // NEAR pricing (for blockchain transactions)
  base_fee: string;
  per_instruction_fee: string;
  per_ms_fee: string;
  per_compile_ms_fee: string;
  // USD pricing (for Payment Keys / HTTPS API)
  base_fee_usd: string;
  per_instruction_fee_usd: string;
  per_sec_fee_usd: string;
  per_compile_ms_fee_usd: string;
  // Limits
  max_compilation_seconds: number;
  max_instructions: number;
  max_execution_seconds: number;
}

/**
 * Fetch list of workers
 */
export async function fetchWorkers(): Promise<WorkerInfo[]> {
  const response = await axios.get(`${getCoordinatorApiUrl()}/public/workers`);
  return response.data;
}

/**
 * Fetch job history
 * @param source - Filter by source: "near", "https", or undefined for all
 */
export async function fetchJobs(
  limit: number = 50,
  offset: number = 0,
  userAccountId?: string,
  source?: 'near' | 'https'
): Promise<JobHistoryEntry[]> {
  const params: Record<string, string | number> = { limit, offset };
  if (userAccountId) {
    params.user_account_id = userAccountId;
  }
  if (source) {
    params.source = source;
  }
  const response = await axios.get(`${getCoordinatorApiUrl()}/public/jobs`, { params });
  return response.data;
}

/**
 * Fetch system statistics
 */
export async function fetchStats(): Promise<ExecutionStats> {
  const response = await axios.get(`${getCoordinatorApiUrl()}/public/stats`);
  return response.data;
}

/**
 * Check if WASM exists for repo/commit/target
 */
export async function checkWasmExists(
  repoUrl: string,
  commitHash: string,
  buildTarget: string = 'wasm32-wasip1'
): Promise<WasmInfo> {
  const response = await axios.get(`${getCoordinatorApiUrl()}/public/wasm/info`, {
    params: {
      repo_url: repoUrl,
      commit_hash: commitHash,
      build_target: buildTarget,
    },
  });
  return response.data;
}

/**
 * Check if WASM exists by checksum (SHA256 hash)
 */
export async function checkWasmExistsByChecksum(
  checksum: string
): Promise<WasmInfo> {
  try {
    const response = await axios.get(`${getCoordinatorApiUrl()}/public/wasm/exists/${checksum}`);
    return {
      exists: response.data.exists,
      checksum: checksum,
      file_size: response.data.file_size || null,
      created_at: response.data.created_at || null,
    };
  } catch (error) {
    // If 404 or other error, WASM doesn't exist
    return {
      exists: false,
      checksum: checksum,
      file_size: null,
      created_at: null,
    };
  }
}

/**
 * Fetch user earnings
 */
export async function fetchUserEarnings(userAccountId: string): Promise<UserEarnings> {
  const response = await axios.get(`${getCoordinatorApiUrl()}/public/users/${userAccountId}/earnings`);
  return response.data;
}

/**
 * Fetch popular repositories
 */
export async function fetchPopularRepos(): Promise<PopularRepo[]> {
  const response = await axios.get(`${getCoordinatorApiUrl()}/public/repos/popular`);
  return response.data;
}

/**
 * Fetch pricing configuration
 */
export async function fetchPricing(): Promise<PricingConfig> {
  const response = await axios.get(`${getCoordinatorApiUrl()}/public/pricing`);
  return response.data;
}

// ============================================================================
// Wallet Balance (authed)
// ============================================================================

export interface WalletBalanceResponse {
  balance: string;
  token: string;
  account_id: string;
}

export interface SupportedToken {
  id: string;
  symbol: string;
  chains: string[];
  decimals: number;
  defuse_asset_id: string;
  price?: number;
  priceUpdatedAt?: string;
}

/** Fetch NEAR balance for a wallet (requires API key) */
export async function fetchWalletBalance(
  baseUrl: string,
  apiKey: string,
): Promise<WalletBalanceResponse> {
  const resp = await fetch(`${baseUrl}/wallet/v1/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`Balance fetch failed: ${resp.status}`);
  return resp.json();
}

/**
 * Fetch supported token catalog from ChainDefuser.
 * Public — no API key needed. Includes prices.
 * assetId maps to defuse_asset_id.
 */
export async function fetchSupportedTokens(): Promise<SupportedToken[]> {
  const resp = await fetch("https://1click.chaindefuser.com/v0/tokens");
  if (!resp.ok) throw new Error(`Token list fetch failed: ${resp.status}`);
  const data = await resp.json();
  const raw = Array.isArray(data) ? data : data.tokens ?? [];
  // Deduplicate by symbol — ChainDefuser returns the same token from many chains (e.g. 15x USDC).
  // Keep the first occurrence per symbol (NEAR-native entries come first).
  const seenSymbol = new Set<string>();
  const deduped = raw.filter((t: Record<string, unknown>) => {
    const sym = String(t.symbol ?? "");
    if (seenSymbol.has(sym)) return false;
    seenSymbol.add(sym);
    return true;
  });
  return deduped.map((t: Record<string, unknown>) => ({
    id: String(t.assetId ?? t.defuse_asset_id ?? ""),
    symbol: String(t.symbol ?? ""),
    chains: [String(t.blockchain ?? "")],
    decimals: Number(t.decimals ?? 0),
    defuse_asset_id: String(t.assetId ?? t.defuse_asset_id ?? ""),
    price: t.price != null ? Number(t.price) : undefined,
    priceUpdatedAt: t.priceUpdatedAt ? String(t.priceUpdatedAt) : undefined,
  }));
}

/**
 * Batch-fetch FT balances on NEAR base chain via backend proxy.
 * Avoids browser CORS issues with direct RPC calls.
 * Returns map of contractId → balance string (only non-zero).
 */
export async function fetchBaseChainBalances(
  accountId: string,
  contractIds: string[],
): Promise<Record<string, string>> {
  try {
    const resp = await fetch(`${WALLET_API_URL}/api/balances/base-chain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, contracts: contractIds }),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    return (data.balances ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Fetch token prices from Rhea Finance.
 * Covers 534+ NEAR-native tokens including ones ChainDefuser misses.
 * Returns map of contractId → { symbol, price, decimal }.
 */
export async function fetchRheaTokenPrices(): Promise<
  Record<string, { symbol: string; price: number; decimal: number }>
> {
  try {
    const resp = await fetch("https://api.rhea.finance/list-token-price");
    if (!resp.ok) return {};
    const data = await resp.json();
    const result: Record<string, { symbol: string; price: number; decimal: number }> = {};
    for (const [contractId, info] of Object.entries(data)) {
      const t = info as { price: string; symbol: string; decimal: number };
      const price = parseFloat(t.price);
      if (!t.symbol || isNaN(price) || price <= 0) continue;
      result[contractId] = {
        symbol: t.symbol,
        price,
        decimal: t.decimal ?? 18,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Uses mt_batch_balance_of (NEP-245) — single RPC call, no API key needed.
 * Returns raw balance strings indexed by token_id.
 */
export async function fetchIntentsBalancesBatch(
  accountId: string,
  tokenIds: string[],
  rpcUrl: string = "https://free.rpc.fastnear.com",
): Promise<string[]> {
  const args = JSON.stringify({
    account_id: accountId,
    token_ids: tokenIds,
  });
  const argsBase64 = btoa(args);

  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: "intents.near",
        method_name: "mt_batch_balance_of",
        args_base64: argsBase64,
      },
    }),
  });
  if (!resp.ok) throw new Error(`RPC call failed: ${resp.status}`);
  const result = await resp.json();
  if (result.error) throw new Error(result.error.message || "RPC error");

  const raw = result?.result?.result;
  if (!raw) throw new Error("Empty RPC result");
  const resultBytes = Uint8Array.from(raw);
  const decoded = new TextDecoder().decode(resultBytes);
  return JSON.parse(decoded);
}

// ============================================================================
// Wallet Stats (public, no auth)
// ============================================================================

export interface WalletStats {
  wallets: { total: number; active: number; deleted: number };
  transactions: {
    total: number;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
  };
  pending_approvals: number;
  registrations_per_day: Array<{ date: string; count: number }>;
  transactions_per_day: Array<{ date: string; count: number }>;
}

export async function fetchWalletStats(): Promise<WalletStats> {
  const response = await axios.get(`${getCoordinatorApiUrl()}/wallet/v1/stats`);
  return response.data;
}

/**
 * API Key Management
 */
export interface CreateApiKeyResponse {
  api_key: string;
  near_account_id: string;
  rate_limit_per_minute: number;
  created_at: number;
}

export interface CreateApiKeyRequest {
  near_account_id: string;
  key_name: string;
  rate_limit_per_minute?: number;
}

/**
 * Create API key (public endpoint - no auth required)
 */
export async function createApiKey(
  request: CreateApiKeyRequest
): Promise<CreateApiKeyResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const response = await axios.post(
    `${baseUrl}/public/api-keys`,
    request
  );
  return response.data;
}

/**
 * Register a new wallet — POST /register (anonymous, no auth required).
 * Returns api_key, near_account_id, and handoff_url.
 */
export interface RegisterWalletResponse {
  wallet_id: string;
  api_key: string;
  near_account_id: string;
  handoff_url: string;
}

export async function registerWallet(network?: NetworkType): Promise<RegisterWalletResponse> {
  const baseUrl = getCoordinatorApiUrl(network);
  const serverKey = import.meta.env.VITE_OUTLAYER_SERVER_KEY;
  const response = await axios.post(`${baseUrl}/register`, {}, {
    headers: serverKey ? { Authorization: `Bearer ${serverKey}` } : {},
  });
  return response.data;
}

/**
 * Register or recover a custody wallet tied to a Google account.
 * Calls our CF Function which routes through OutLayer wallet_auth.
 * Uses OutLayer storage for cross-device recovery.
 */
export interface WalletAuthResponse {
  status: string;
  api_key: string;
  near_account_id?: string;
  message?: string;
}

export async function registerWalletWithGoogle(idToken: string): Promise<WalletAuthResponse> {
  WALLET_API_URL;
  const response = await axios.post(`${WALLET_API_URL}/api/wallet_auth`, { id_token: idToken });
  const data = response.data;

  if (data.error) {
    throw new Error(data.error);
  }
  if (data.status !== 'ok') {
    throw new Error(data.message || 'Wallet auth failed');
  }
  return data;
}

export interface WalletCheckResponse {
  status: string;
  exists: boolean;
  api_key: string | null;
  near_account_id: string | null;
}

export async function checkGoogleWallet(idToken: string): Promise<WalletCheckResponse> {
  WALLET_API_URL;
  const response = await axios.post(`${WALLET_API_URL}/api/wallet/check`, { id_token: idToken });
  const data = response.data;

  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function linkWalletToGoogle(idToken: string, apiKey: string, nearAccountId: string): Promise<{ status: string; linked: boolean }> {
  WALLET_API_URL;
  const response = await axios.post(`${WALLET_API_URL}/api/wallet/link`, {
    id_token: idToken,
    api_key: apiKey,
    near_account_id: nearAccountId,
  });
  const data = response.data;

  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function unlinkWalletFromGoogle(idToken: string, walletIndex: number, nearAccountId: string): Promise<{ status: string; unlinked: boolean; message?: string }> {
  WALLET_API_URL;
  const response = await axios.post(`${WALLET_API_URL}/api/wallet/unlink`, {
    id_token: idToken,
    wallet_index: walletIndex,
    near_account_id: nearAccountId,
  });
  const data = response.data;

  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export interface WalletLabel {
  index: number;
  label: string;
}

export async function fetchWalletLabels(idToken: string): Promise<WalletLabel[]> {
  WALLET_API_URL;
  const response = await axios.post(`${WALLET_API_URL}/api/wallet/labels`, { id_token: idToken });
  const data = response.data;
  if (data.error) throw new Error(data.error);
  return data.labels || [];
}

export async function setWalletLabel(idToken: string, label: string, walletIndex?: number, nearAccountId?: string): Promise<{ status: string }> {
  WALLET_API_URL;
  const body: Record<string, string | number> = { id_token: idToken, label };
  if (walletIndex !== undefined) body.wallet_index = walletIndex;
  if (nearAccountId) body.near_account_id = nearAccountId;
  const response = await axios.post(`${WALLET_API_URL}/api/wallet/set-label`, body);
  const data = response.data;
  if (data.error) throw new Error(data.error);
  return data;
}

/** Attestation data types */
export interface AttestationResponse {
  id: number;
  task_id: number;
  task_type: string;

  // TDX attestation data
  tdx_quote: string; // base64 encoded
  worker_measurement: string;

  // NEAR context (for blockchain calls)
  request_id?: number;
  caller_account_id?: string;
  transaction_hash?: string;
  block_height?: number;

  // HTTPS context (for HTTPS API calls)
  call_id?: string;
  payment_key_owner?: string;
  payment_key_nonce?: number;

  // Code source
  repo_url?: string;
  commit_hash?: string;
  build_target?: string;

  // Task data hashes
  wasm_hash?: string;
  input_hash?: string;
  output_hash: string;

  // V1 attestation fields (for jobs after OUTLAYER_ATTESTATION_V1)
  project_id?: string;
  secrets_ref?: string;
  attached_usd?: string;

  timestamp: number; // Unix timestamp
}

/**
 * Fetch attestation for a specific task by job ID (public endpoint)
 * Returns null if attestation doesn't exist
 */
export async function fetchAttestation(
  taskId: number
): Promise<AttestationResponse | null> {
  try {
    const response = await axios.get(
      `${getCoordinatorApiUrl()}/attestations/${taskId}`
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null; // Attestation doesn't exist
    }
    throw error;
  }
}

// ============================================================================
// Confidential Intents (mainnet-only)
//
// Private shard at `intents.far`. On-chain state with no public RPC. Shield,
// unshield, transfer, swap, withdraw, and read balances. Action routes are
// async and return a `request_id` to poll via /wallet/v1/requests/{id}.
// ============================================================================

export interface ConfidentialBalance {
  /** Map of defuse asset id → raw balance string (atomic units) */
  balances?: Record<string, string> | Array<{ token: string; balance: string }>;
  /** Some endpoints return a flat array of {asset_id, amount} */
  items?: Array<{ asset_id: string; amount: string }>;
}

export interface ConfidentialRequestResponse {
  request_id: string;
  status: string;
  /** Optional fields populated on terminal states */
  tx_hash?: string;
  error?: string;
}

export interface ConfidentialQuoteResponse {
  /** Quote shape varies; pass through to UI */
  [key: string]: unknown;
}

/**
 * Read confidential balances. Mainnet-only.
 *
 * `apiKey` is the wallet key (Bearer wk_...).
 */
export async function fetchConfidentialBalance(
  apiKey: string,
): Promise<ConfidentialBalance> {
  const baseUrl = getCoordinatorApiUrl();
  const resp = await fetch(`${baseUrl}/wallet/v1/confidential/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Balance fetch failed: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Shield funds into the confidential shard. Async — returns request_id.
 *
 * The wallet must already hold the token in its public intents balance.
 * `token` is the defuse asset id (e.g. "nep141:wrap.near" or the ChainDefuser id).
 * `amount` is atomic units as a string.
 */
export async function shieldToConfidential(
  apiKey: string,
  token: string,
  amount: string,
): Promise<ConfidentialRequestResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const resp = await fetch(`${baseUrl}/wallet/v1/confidential/deposit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, amount }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Shield failed: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Move funds from the confidential shard back to the wallet's public intents
 * balance. Async — returns request_id.
 */
export async function unshieldFromConfidential(
  apiKey: string,
  token: string,
  amount: string,
): Promise<ConfidentialRequestResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const resp = await fetch(`${baseUrl}/wallet/v1/confidential/unshield`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, amount }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Unshield failed: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Transfer privately to another confidential wallet. Async.
 *
 * `to` is the recipient's wallet address (NEAR implicit). The recipient must
 * already have a confidential identity on the same shard.
 */
export async function confidentialTransfer(
  apiKey: string,
  token: string,
  amount: string,
  to: string,
): Promise<ConfidentialRequestResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const resp = await fetch(`${baseUrl}/wallet/v1/confidential/transfer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, amount, to }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Confidential transfer failed: ${resp.status}`);
  }
  return resp.json();
}

/** Get a quote for a confidential swap. Synchronous. */
export async function confidentialSwapQuote(
  apiKey: string,
  inputToken: string,
  outputToken: string,
  amount: string,
): Promise<ConfidentialQuoteResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const params = new URLSearchParams({
    token_in: inputToken,
    token_out: outputToken,
    amount_in: amount,
  });
  const resp = await fetch(
    `${baseUrl}/wallet/v1/confidential/swap/quote?${params}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Quote failed: ${resp.status}`);
  }
  return resp.json();
}

/** Execute a confidential swap. Async — returns request_id. */
export async function confidentialSwap(
  apiKey: string,
  inputToken: string,
  outputToken: string,
  amount: string,
  minOutputAmount?: string,
): Promise<ConfidentialRequestResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const body: Record<string, unknown> = {
    token_in: inputToken,
    token_out: outputToken,
    amount_in: amount,
  };
  if (minOutputAmount) body.min_output_amount = minOutputAmount;
  const resp = await fetch(`${baseUrl}/wallet/v1/confidential/swap`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Confidential swap failed: ${resp.status}`);
  }
  return resp.json();
}

/** Withdraw from the confidential shard to an external chain address. Async. */
export async function confidentialWithdraw(
  apiKey: string,
  token: string,
  amount: string,
  toAddress: string,
  chain: string,
): Promise<ConfidentialRequestResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const resp = await fetch(`${baseUrl}/wallet/v1/confidential/withdraw`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, amount, to: toAddress, chain }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Confidential withdraw failed: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Poll a confidential request by id. Same endpoint as public wallet requests.
 * Returns terminal status (completed / failed) and tx_hash when available.
 */
export async function fetchConfidentialRequestStatus(
  apiKey: string,
  requestId: string,
): Promise<ConfidentialRequestResponse> {
  const baseUrl = getCoordinatorApiUrl();
  const resp = await fetch(
    `${baseUrl}/wallet/v1/requests/${encodeURIComponent(requestId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || err.message || `Status fetch failed: ${resp.status}`);
  }
  return resp.json();
}


