# OutLayer Wallet

Mobile-first PWA for managing NEAR custody wallet policies. Connect your NEAR wallet, view wallets you own, set spending limits, configure approval flows, and monitor audit logs.

**Live:** https://outlayer-wallet.pages.dev

## Features

- **Wallet Management** — View wallets where your account is the policy owner. Freeze/unfreeze wallets.
- **Policy Editor** — Set spending limits (per-transaction, hourly, daily, monthly), address restrictions (whitelist/blacklist), allowed tokens, transaction types, time restrictions, rate limits, and webhook URLs.
- **Approval System** — Require personal approval for transactions. Configure which types need approval, how many signatures are required, and add additional approvers.
- **Audit Log** — Paginated transaction history with detail view.
- **Live JSON Preview** — Form changes sync to a policy JSON editor in real time. Edit JSON directly if needed.
- **Handoff Flow** — AI agents can share a handoff URL (`/wallet?key=wk_...`) for new owners to set policy.

## Tech Stack

- **Vite + React + TypeScript** (no Next.js — required for `@hot-labs/near-connect` Firefox compatibility)
- **TanStack Query** — server state with localStorage cache persistence (30-min TTL)
- **shadcn/ui** — New York style, zinc color palette
- **Radix UI** — accessible primitives (Checkbox, Dialog, etc.)
- **@hot-labs/near-connect** — NEAR wallet connection
- **Tailwind CSS v4**
- **Cloudflare Pages** — deployment

## Pages

| Route | Description |
|---|---|
| `/wallet/manage` | Wallet list, freeze/unfreeze, API key management |
| `/wallet/approvals` | Pending transaction approvals (auto-polls every 30s) |
| `/wallet/audit` | Transaction history with detail drill-down |
| `/wallet` (`?key=wk_...`) | Policy editor (handoff flow) |
| `/wallet/fund` (`?to=&amount=`) | Fund wallet (deep-link only) |

## Development

```bash
npm install
npx vite --port 3003 --host
```

## Build & Deploy

```bash
npx vite build
npx wrangler pages deploy dist --project-name outlayer-wallet
```

## Architecture Notes

- **SPA routing** — `public/_redirects` handles all routes → `index.html` on Cloudflare Pages
- **No `useSearchParams()`** — replaced with `useLocation().search` to avoid React Router v7 Suspense triggers
- **localStorage cache** — query cache (`outlayer-query-cache`) and account ID (`outlayer-cached-account`) persist across reloads to eliminate loading flashes
- **Policy sync** — `usePolicyForm` hook with `useMemo` + `useEffect` keeps form ↔ JSON editor in sync; manual JSON edits are tracked via `jsonEdited` flag
