/**
 * NEAR RPC utilities for transaction data fetching
 */

import { rpcQuery, type NetworkType } from './rpc-pool';

export type { NetworkType };

/**
 * Query account balance directly from NEAR RPC.
 * Returns balance in yoctoNEAR (string).
 *
 * Uses the rpc-pool: circuit breaker on 429, in-flight dedup, 10 s cache.
 */
export async function fetchNearAccountBalance(
  accountId: string,
  network: NetworkType = 'mainnet',
): Promise<string> {
  const result = await rpcQuery<{ amount: string }>(
    network,
    'query',
    {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    },
    { cacheTtlMs: 10_000, timeoutMs: 6_000 },
  );
  return result.amount;
}

/**
 * Run an arbitrary view-function call on a NEAR contract.
 * Decodes the base64-style byte array returned by `call_function`.
 */
export async function viewFunction<T = unknown>(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  network: NetworkType = 'mainnet',
): Promise<T> {
  const argsBase64 = btoa(JSON.stringify(args));
  const result = await rpcQuery<{ result: number[] }>(
    network,
    'query',
    {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    },
    { cacheTtlMs: 10_000, timeoutMs: 8_000 },
  );
  const raw = result?.result;
  if (!raw) throw new Error('Empty RPC result');
  const decoded = new TextDecoder().decode(Uint8Array.from(raw));
  // Empty contract return (void) is "null" or "" after decode
  if (!decoded || decoded === 'null') return null as T;
  return JSON.parse(decoded) as T;
}

/**
 * Get NEAR Archival RPC URL for the given network (for old transactions)
 */
function getNearArchivalRpcUrl(network: NetworkType): string {
  if (network === 'mainnet') {
    return import.meta.env.VITE_MAINNET_ARCHIVAL_RPC_URL || 'https://archival-rpc.mainnet.fastnear.com';
  }
  return import.meta.env.VITE_TESTNET_ARCHIVAL_RPC_URL || 'https://archival-rpc.testnet.fastnear.com';
}

/**
 * Transaction outcome structure from NEAR RPC
 */
interface TransactionOutcome {
  receipts_outcome: Array<{
    id: string;
    outcome: {
      status: {
        SuccessValue?: string; // base64 encoded
        SuccessReceiptId?: string;
        Failure?: unknown;
      };
      logs: string[];
      receipt_ids: string[];
      executor_id: string;
    };
  }>;
  transaction: {
    signer_id: string;
    receiver_id: string;
  };
}

/**
 * Fetch transaction data from NEAR RPC
 * Uses archival RPC for better reliability with old transactions (>2 epochs)
 */
export async function fetchTransaction(
  txHash: string,
  accountId: string,
  network: NetworkType = 'testnet'
): Promise<TransactionOutcome> {
  // Always use archival RPC for transaction lookups (older than 2 epochs)
  const rpcUrl = getNearArchivalRpcUrl(network);

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dontcare',
      method: 'EXPERIMENTAL_tx_status',
      params: [txHash, accountId]
    })
  });

  if (!response.ok) {
    throw new Error(`NEAR RPC request failed: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    // TIMEOUT_ERROR means transaction not found
    if (data.error.cause?.name === 'TIMEOUT_ERROR') {
      throw new Error(
        `Transaction not found. Please verify the transaction hash is correct. ` +
        `View on NEAR Explorer: https://${network === 'mainnet' ? '' : 'testnet.'}nearblocks.io/txns/${txHash}`
      );
    }
    throw new Error(`NEAR RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.result;
}

/**
 * Extract output from transaction (from outlayer contract receipt)
 * @param tx - Transaction outcome
 * @param network - Network type to determine correct contract ID
 */
export function extractOutputFromTransaction(
  tx: TransactionOutcome,
  network: NetworkType = 'testnet'
): string | null {
  // Get the outlayer contract ID based on network
  const outlayerContractId = network === 'testnet'
    ? import.meta.env.VITE_TESTNET_CONTRACT_ID || 'outlayer.testnet'
    : import.meta.env.VITE_MAINNET_CONTRACT_ID || 'outlayer.near';

  // Find receipt from outlayer contract - this contains the full JSON structure
  const outlayerReceipt = tx.receipts_outcome.find(
    receipt => receipt.outcome.status.SuccessValue &&
              receipt.outcome.executor_id === outlayerContractId
  );

  if (!outlayerReceipt) {
    // No receipt from outlayer contract found
    return null;
  }

  const outputBase64 = outlayerReceipt.outcome.status.SuccessValue;
  if (!outputBase64) {
    return null;
  }

  try {
    const outputStr = atob(outputBase64);
    return outputStr;
  } catch (e) {
    console.error('Failed to decode output base64:', e);
    return null;
  }
}

/**
 * Extract input data from transaction execution_requested event
 */
export function extractInputFromTransaction(tx: TransactionOutcome): string | null {
  // Search all receipts for execution_requested event
  for (const receipt of tx.receipts_outcome) {
    for (const log of receipt.outcome.logs) {
      if (log.includes('EVENT_JSON:') && log.includes('execution_requested')) {
        try {
          // Parse event log
          const eventJson = log.replace('EVENT_JSON:', '');
          const event = JSON.parse(eventJson);

          if (event.event === 'execution_requested' && event.data && event.data[0]) {
            const requestData = JSON.parse(event.data[0].request_data);
            return requestData.input_data || '';
          }
        } catch (e) {
          console.error('Failed to parse execution_requested event:', e);
        }
      }
    }
  }

  return null;
}

/**
 * Calculate SHA256 hash of string (browser-compatible)
 */
export async function sha256(message: string): Promise<string> {
  // Encode message as UTF-8
  const msgBuffer = new TextEncoder().encode(message);

  // Hash the message
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);

  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}
