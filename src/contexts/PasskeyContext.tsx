import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

interface PasskeyUser {
  credentialId: string
  publicKey: string
  chains: string[]
}

interface PasskeyState {
  user: PasskeyUser | null
  isConnecting: boolean
  isConnected: boolean
  connect: () => Promise<void>
  disconnect: () => void
}

const PasskeyContext = createContext<PasskeyState>({
  user: null,
  isConnecting: false,
  isConnected: false,
  connect: async () => {},
  disconnect: () => {},
})

export const usePasskey = () => useContext(PasskeyContext)

export function PasskeyProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PasskeyUser | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const connect = useCallback(async () => {
    setIsConnecting(true)
    try {
      // Passkey WebAuthn flow — actual implementation in passkey lib
      console.log('[PasskeyContext] connect — to be wired to passkey lib')
    } catch (err) {
      console.error('[PasskeyContext] connect failed:', err)
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setUser(null)
  }, [])

  // Restore session from IndexedDB on mount
  useEffect(() => {
    // Session restore — to be wired to session lib
  }, [])

  return (
    <PasskeyContext.Provider
      value={{
        user,
        isConnecting,
        isConnected: !!user,
        connect,
        disconnect,
      }}
    >
      {children}
    </PasskeyContext.Provider>
  )
}
