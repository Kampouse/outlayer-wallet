<p align="center">
  <img src="https://wallet.jemartel.dev/favicon.svg" alt="OutLayer Wallet" width="64" height="64">
</p>

<h1 align="center">OutLayer Wallet</h1>

<p align="center">
  Multi-wallet custody manager for NEAR Protocol<br>
  <strong>Balances · Sends · Swaps · Policies · Approvals</strong>
</p>

<p align="center">
  <a href="https://wallet.jemartel.dev">wallet.jemartel.dev</a> ·
  <a href="https://outlayer-wallet.pages.dev">Pages mirror</a>
</p>

---

## What is it?

OutLayer Wallet is a mobile-first PWA that lets you **manage multiple NEAR custody wallets** from one place. Each wallet has its own API key, spending limits, and approval rules — think of it as a 1Password-style vault for on-chain wallets.

**Key capabilities:**

- 🏠 **Home dashboard** — balance overview, token list with market prices, quick actions
- 💸 **Send & Swap** — transfer tokens or swap via Intents with USD pricing
- 🔐 **Wallet creation** — generate wallets with Ed25519 keypairs, encrypted API keys
- 📋 **Policy editor** — per-transaction/daily/monthly limits, allowed tokens, address restrictions, time locks, webhook alerts
- ✅ **Approval flows** — require personal sign-off before transactions execute
- 📜 **Audit log** — full transaction history with receipt drill-down
- 🔄 **Multi-device sync** — wallets linked to your Google account sync across devices
- 🔑 **AI agent handoff** — agents share a `/wallet?key=wk_...` URL for new owners to claim

## Screens

| | | |
|---|---|---|
| **Home** — balance + tokens + action ring | **Manage** — wallet list, keys, policies | **Send** — transfer with Intents/Base chain |
| **Swap** — token swap with USD pricing | **Approvals** — pending tx sign-off | **Audit** — transaction history |

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 19 + TypeScript (Vite SPA) |
| Styling | Tailwind CSS v4, shadcn/ui (New York) |
| State | TanStack Query v5, localStorage persistence (30-min TTL) |
| Auth | Google OAuth → Ed25519 key derivation → AES-256-GCM API key encryption |
| Chain | `@hot-labs/near-connect`, Intents SDK, Rhea Finance (534 tokens) |
| Backend | Hono on Cloudflare Workers |
| Hosting | Cloudflare Pages + Custom domain |
| RPC | Round-robin across 5 mainnet endpoints (fastnear, near.org, lava, drpc, omniatech) |

## Pages

| Route | Description |
|---|---|
| `/` | Home — balance, token list, quick actions |
| `/wallet/manage` | Wallet list, freeze/unfreeze, API key management |
| `/wallet/send` | Send tokens (Intents + base chain) |
| `/wallet/swap` | Token swap with price estimation |
| `/wallet/approvals` | Pending transaction approvals (30s auto-poll) |
| `/wallet/audit` | Transaction history with detail drill-down |
| `/wallet` (`?key=wk_...`) | Policy editor (handoff flow) |
| `/wallet/fund` (`?to=&amount=`) | Fund wallet (deep-link) |
| `/settings` | App settings, theme, connected accounts |

## Development

```bash
# Install
npm install

# Run dev server (port 3003)
npx vite --port 3003 --host
```

**Environment variables** (optional — defaults to public endpoints):

```
VITE_MAINNET_RPC_URL=          # Override mainnet RPC
VITE_TESTNET_RPC_URL=          # Override testnet RPC
VITE_MAINNET_CONTRACT_ID=      # OutLayer contract ID (mainnet)
VITE_TESTNET_CONTRACT_ID=      # OutLayer contract ID (testnet)
VITE_WALLET_API_URL=           # Backend API URL
```

## Build & Deploy

```bash
# Build (skip tsc — use vite directly)
node node_modules/vite/bin/vite.js build

# Deploy frontend
npx wrangler pages deploy dist --project-name outlayer-wallet

# Deploy backend (Hono Worker)
npx wrangler deploy index.ts --name wallet-api
```

## Architecture

- **SPA** — `public/_redirects` routes all paths → `index.html` on Cloudflare Pages
- **Multi-wallet** — Google account links multiple wallets; Ed25519 keypairs stored encrypted in localStorage with PBKDF2 key derivation from Google sub
- **RPC proxy** — backend proxies base chain FT balance queries to avoid browser CORS; round-robin across 5 endpoints to prevent rate limiting
- **React Query persistence** — `PersistQueryClientProvider` with `createAsyncStoragePersister` caches query results in localStorage (30-min TTL)
- **Token coverage** — Intents SDK for native NEAR swaps; Rhea Finance for 534 base chain tokens; auto-matched CMC icons for 86 tokens
- **Dark theme** — warm blue-black background, lime accent, shadcn CSS variable tokens throughout
- **Mobile-first** — 44px+ touch targets, bottom sheet modals, Phantom-style action ring, bottom tab navigation

## Security

- API keys encrypted with AES-256-GCM, key derived via PBKDF2 (100k iterations) from Google OAuth sub
- All backend endpoints require verified Google `id_token`
- Wallet keys never leave the device unencrypted
- Spending limits enforced on-chain via OutLayer contract policies
