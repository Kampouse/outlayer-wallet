# Contributing to OutLayer Wallet

Thank you for your interest in contributing! This guide will get you set up and productive quickly.

## What is OutLayer Wallet?

OutLayer Wallet is an open-source **AI agent custody wallet** built on the NEAR Protocol. It provides:

- **NEAR Intents** — cross-chain token swaps and transfers via intent-based architecture
- **Confidential transfers** — private shards and encrypted balance operations
- **Multi-sig approvals** — policy-based spending controls for AI agents
- **Key management** — authorized keys, API key hashing, and secure local storage

Agents hold funds safely. Humans stay in control.

**Repo:** [github.com/Kampouse/outlayer-wallet](https://github.com/Kampouse/outlayer-wallet)
**Live:** [wallet.jemartel.dev](https://wallet.jemartel.dev)

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Build | Vite |
| UI | React 19 + TypeScript (strict) |
| Styling | Tailwind CSS v4 + CSS custom properties |
| Components | shadcn/ui |
| Server state | @tanstack/react-query |
| Hosting | Cloudflare Pages (auto-deploys from `main`) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/Kampouse/outlayer-wallet.git
cd outlayer-wallet
npm i
```

### Development

```bash
npm run dev          # Start Vite dev server
npm run build        # Type-check (tsc -b) then build
npm run preview      # Preview production build locally
npm run lint         # ESLint
```

### Environment

Copy `.env.example` to `.env` and fill in any required values. The app connects to a coordinator API for wallet operations — check `src/lib/api.ts` for endpoint configuration.

---

## Project Structure

```
src/
├── main.tsx              # Entry point, renders App
├── App.tsx               # Router, React.lazy page loading, layout shell
├── index.css             # Tailwind v4 imports, CSS custom properties (theme)
├── App.css               # Global styles
├── assets/               # Static images
├── components/
│   ├── ui/               # shadcn/ui primitives (button, card, dialog, input…)
│   ├── wallet/           # Wallet-specific sub-components
│   ├── BottomNav.tsx     # Fixed bottom navigation (mobile)
│   ├── BottomSheetModal.tsx
│   ├── TokenIcon.tsx
│   ├── TokenPickerModal.tsx
│   ├── ToastProvider.tsx
│   ├── ErrorBoundary.tsx
│   └── …                 # Other shared components
├── pages/
│   ├── HomePage.tsx           # Main dashboard, balance display
│   ├── WalletPage.tsx         # Wallet list, create, import
│   ├── WalletSendPage.tsx     # Send tokens
│   ├── WalletSwapPage.tsx     # Swap via NEAR Intents
│   ├── WalletFundPage.tsx     # Deposit / bridge tokens
│   ├── WalletPrivatePage.tsx  # Confidential transfers
│   ├── WalletManagePage.tsx   # Settings, policies, authorized keys
│   ├── WalletApprovalsPage.tsx # Multi-sig approval queue
│   ├── WalletAuditPage.tsx    # Transaction audit log
│   ├── WalletHistoryPage.tsx  # Transaction history
│   ├── ApprovalDetailPage.tsx # Single approval detail
│   └── SettingsPage.tsx       # App settings
├── hooks/
│   ├── useWalletBalances.ts   # Token balance fetching
│   ├── useConfidentialData.ts # Confidential balance / tx
│   ├── usePolicyForm.ts       # Policy form state
│   ├── useApiKeyHash.ts       # API key hashing
│   └── useGridHighlight.ts    # Grid animation
├── lib/
│   ├── api.ts                 # Coordinator API client
│   ├── wallet-keys.ts         # Local wallet key storage
│   ├── wallet-policy.ts       # Policy CRUD helpers
│   ├── google-auth.ts         # Google OAuth flow
│   ├── ecies.ts               # ECIES encryption
│   ├── explorer.ts            # Block explorer URLs
│   ├── near-rpc.ts            # NEAR RPC helpers
│   ├── rpc-pool.ts            # RPC endpoint pooling
│   ├── transaction-decode.ts  # Transaction decoding
│   ├── utils.ts               # General utilities (cn, formatPrice, etc.)
│   ├── wasm-hash.ts           # WASM-based hashing
│   ├── url-params.ts          # URL parameter helpers
│   └── gridHighlight.ts      # Grid animation math
└── contexts/
    └── NearWalletContext.tsx   # NEAR wallet connection state (NIP-07, etc.)
```

### Key directories

- **`src/pages/`** — Route-level components, one file per page. All lazy-loaded via `React.lazy()` in `App.tsx`. Add new pages here.
- **`src/components/`** — Shared UI. Put reusable pieces at this level; wallet-specific sub-components go in `components/wallet/`.
- **`src/components/ui/`** — shadcn/ui primitives only. Manage via the shadcn CLI; don't hand-edit unless necessary.
- **`src/hooks/`** — Custom React hooks. Server data hooks use React Query; local UI state uses `useState`/`useRef`.
- **`src/lib/`** — Pure logic, API clients, utilities. No React imports. Keep functions small and exportable.
- **`src/contexts/`** — React context providers. Keep these thin; put real logic in hooks or lib.

---

## Architecture Conventions

### Theming — use CSS variables, never hardcoded colors

The theme is defined as CSS custom properties in `src/index.css` and consumed through Tailwind utility classes:

```
--background, --foreground, --card, --border, --muted, --muted-foreground, --ring, --input
```

**Use these Tailwind classes:**

- `text-foreground` / `text-muted-foreground`
- `bg-card` / `bg-muted` / `bg-background`
- `border-border`

**Never use hardcoded colors:**

- ~~`text-white`~~
- ~~`text-zinc-400`~~
- ~~`bg-white/[0.04]`~~
- ~~`text-gray-500`~~

This ensures the theme stays consistent and future theming (light mode, etc.) works automatically.

### CTA buttons

Primary call-to-action buttons use:

```tsx
<button className="bg-lime-500 text-black">Action</button>
```

### Glassmorphism cards

```tsx
<div className="bg-card/50 border border-border/50 rounded-xl p-4">
```

### Font

Geist Variable — already configured globally. Do not add custom font classes.

### shadcn/ui components

Import only what you need from `src/components/ui/`:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
```

Add new shadcn components with the CLI:

```bash
npx shadcn@latest add <component>
```

### State management

| State type | Approach |
|------------|----------|
| Server / async data | `@tanstack/react-query` hooks in `src/hooks/` |
| Local UI state | `useState`, `useRef` |
| Global app state | React Context in `src/contexts/` |

### Routing and pages

- Pages live in `src/pages/` and are **lazy-loaded** via `React.lazy()` in `App.tsx`
- Mobile wallet views: wrap in `max-w-lg mx-auto`
- Desktop dashboard views: **no** `max-w-lg` — use full width
- Mobile navigation uses the fixed `BottomNav` (4 tabs)

### UI copy rules

- **No em-dashes** (`—`) in any user-facing text. Use a colon, period, or dash instead.
- **No explanatory labels** — icons and layout should be self-explanatory. Trust the user.

### Additive only

**Never rewrite existing views.** If a page needs changes, add new components or new pages alongside the existing ones. Existing views are stable — extend, don't replace.

---

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary (and then add a comment explaining why)
- **Functional components** with hooks — no class components
- **Named exports** — avoid `export default`
- **Single responsibility** — one hook per file, one component per file
- **Barrel imports from `@/`** — use the `@/` path alias configured in tsconfig

```tsx
// Good
export function TokenBalance({ tokenId }: { tokenId: string }) {
  const { data } = useWalletBalances(tokenId);
  return <span>{formatPrice(data)}</span>;
}

// Bad — default export, hardcoded color, em-dash
export default function TokenBalance() {
  return <span className="text-white">Balance — $0</span>;
}
```

---

## Git Workflow

### Conventional commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add token search filter to WalletSwapPage
fix: resolve balance refresh after confidential transfer
chore: update dependencies
docs: add CONTRIBUTING.md
style: format with prettier
refactor: extract balance card into shared component
```

### Branch and PR flow

1. Fork the repo (or create a feature branch)
2. Make your changes
3. Ensure `npm run build` passes
4. Ensure `npm run lint` is clean
5. Open a pull request against `main`
6. Describe what changed and why

### Deploy

The `main` branch auto-deploys to Cloudflare Pages. Merged PRs go live automatically.

---

## Testing

Testing infrastructure is minimal at this stage. If you add tests:

- Place test files next to the source file: `useWalletBalances.test.ts`
- Use Vitest (compatible with Vite out of the box)
- Focus on testing hooks and lib functions — they're pure and easy to test

---

## Questions?

Open an issue on GitHub or reach out in the project's discussion forum. Happy hacking!
