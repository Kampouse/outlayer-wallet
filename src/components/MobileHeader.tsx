import { useState } from 'react'
import { useNearWallet } from '@/contexts/NearWalletContext'
import { getAllWalletKeys } from '@/lib/wallet-keys'
import WalletPickerModal from './WalletPickerModal'
import { ChevronDown } from 'lucide-react'

function useWalletLabel(accountId: string | null) {
  if (!accountId) return null
  const keys = getAllWalletKeys()
  const match = Object.entries(keys).find(([pk]) => pk === `ed25519:${accountId}`)
  if (!match) return accountId.length > 20 ? `${accountId.slice(0, 10)}...${accountId.slice(-4)}` : accountId
  const entry = match[1]
  return entry.label
    || (entry.googleEmail ? entry.googleEmail.split('@')[0] : null)
    || (accountId.length > 20 ? `${accountId.slice(0, 10)}...${accountId.slice(-4)}` : accountId)
}

export default function MobileHeader() {
  const { accountId, isConnected, googleUser, switchToWallet, disconnect } = useNearWallet()
  const name = useWalletLabel(isConnected ? accountId : null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const walletCount = Object.keys(getAllWalletKeys()).length
  const showPicker = isConnected && walletCount > 1
  // Allow opening picker with 1 wallet too (for logout access)
  const canOpenPicker = isConnected

  return (
    <>
      <header className="sticky top-0 z-40 bg-transparent">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="w-7 h-7" />

          <div className="flex items-center gap-2">
            {isConnected && name ? (
              <button
                onClick={() => canOpenPicker && setPickerOpen(true)}
                className={`flex items-center gap-1.5 ${canOpenPicker ? 'cursor-pointer active:opacity-70' : ''}`}
                disabled={!canOpenPicker}
              >
                {googleUser?.picture ? (
                  <img
                    src={googleUser.picture}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-xs text-muted-foreground">{name}</span>
                {canOpenPicker && <ChevronDown size={12} className="text-muted-foreground" />}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <WalletPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        activeAccountId={accountId}
        onSelect={switchToWallet}
        onLogout={disconnect}
      />
    </>
  )
}
