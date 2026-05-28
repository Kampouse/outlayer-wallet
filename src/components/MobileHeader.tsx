import { Link } from 'react-router-dom'
import { useNearWallet } from '@/contexts/NearWalletContext'
import ThemeToggle from './ThemeToggle'

export default function MobileHeader() {
  const { accountId, isConnected, authMethod, disconnect, requestLogin } = useNearWallet()

  const name = isConnected && accountId
    ? accountId.length > 20
      ? `${accountId.slice(0, 10)}...${accountId.slice(-4)}`
      : accountId
    : null

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border">
      <div className="flex items-center justify-between px-4 h-12">
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-primary-foreground"/>
              <circle cx="5.5" cy="8" r="1.5" fill="currentColor" className="text-primary-foreground"/>
              <path d="M10 6.5L12.5 8L10 9.5V6.5Z" fill="currentColor" className="text-primary-foreground"/>
            </svg>
          </div>
          {name && authMethod === 'near' ? (
            <span className="text-sm font-medium text-foreground truncate">
              {name}
            </span>
          ) : (
            <span className="text-sm font-semibold text-foreground tracking-tight">Outlayer</span>
          )}
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {isConnected ? (
            <>
              {authMethod === 'near' && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  NEAR
                </span>
              )}
              <button
                onClick={disconnect}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Disconnect"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={requestLogin}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Login
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
