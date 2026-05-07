import { Link } from 'react-router-dom'
import { useNearWallet } from '@/contexts/NearWalletContext'

export default function MobileHeader() {
  const { accountId, isConnected, network } = useNearWallet()

  const name = isConnected && accountId
    ? accountId.length > 20
      ? `${accountId.slice(0, 10)}...${accountId.slice(-4)}`
      : accountId
    : null

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-zinc-200/80">
      <div className="flex items-center justify-between px-4 h-12">
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-md bg-zinc-900 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="10" rx="2" stroke="white" strokeWidth="1.5"/>
              <circle cx="5.5" cy="8" r="1.5" fill="white"/>
              <path d="M10 6.5L12.5 8L10 9.5V6.5Z" fill="white"/>
            </svg>
          </div>
          {name ? (
            <span className="text-sm font-medium text-zinc-900 truncate">{name}</span>
          ) : (
            <span className="text-sm font-semibold text-zinc-900 tracking-tight">Outlayer</span>
          )}
        </Link>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
          network === 'testnet'
            ? 'bg-amber-50 text-amber-600 border border-amber-200'
            : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
        }`}>
          {network === 'testnet' ? 'Testnet' : 'Mainnet'}
        </span>
      </div>
    </header>
  )
}
