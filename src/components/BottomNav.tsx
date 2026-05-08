import { NavLink } from 'react-router-dom'
import { Globe, SendHorizontal, ArrowDownUp, ShieldCheck, ClipboardList } from 'lucide-react'

const tabs = [
  { to: '/', label: 'Wallets', icon: Globe },
  { to: '/wallet/send', label: 'Send', icon: SendHorizontal },
  { to: '/wallet/swap', label: 'Swap', icon: ArrowDownUp },
  { to: '/wallet/approvals', label: 'Approvals', icon: ShieldCheck },
  { to: '/wallet/audit', label: 'Audit', icon: ClipboardList },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto sm:max-w-xl md:max-w-2xl">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                  isActive
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-emerald-500" />
                  )}
                  <Icon
                    size={isActive ? 20 : 18}
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                  <span>{tab.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
