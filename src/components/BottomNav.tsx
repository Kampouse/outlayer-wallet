import { NavLink } from 'react-router-dom'
import { Wallet, Clock, ShieldCheck, Settings, Shield } from 'lucide-react'

const tabs = [
  { to: '/', label: 'Home', icon: Wallet, end: true },
  { to: '/wallet/private', label: 'Private', icon: Shield, end: false },
  { to: '/wallet/history', label: 'Activity', icon: Clock, end: false },
  { to: '/wallet/approvals', label: 'Approvals', icon: ShieldCheck, end: false },
  { to: '/wallet/manage', label: 'Settings', icon: Settings, end: false },
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
              end={tab.end}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                  isActive
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-lime-500" />
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
