import { useNearWallet } from '@/contexts/NearWalletContext';
import { useState, useEffect } from 'react';
import type { NetworkType } from '@/contexts/NearWalletContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface WalletConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Google "G" logo SVG (official colors)
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function WalletConnectionModal({ isOpen, onClose }: WalletConnectionModalProps) {
  const {
    network,
    switchNetwork,
    connect,
    isNearConnected,
    isWalletReady,
    connectWithGoogle,
    googleAuthLoading,
    authMethod,
    nearAccountId,
  } = useNearWallet();
  const [pendingNetwork, setPendingNetwork] = useState<NetworkType>(network);

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const showGoogleButton = !!googleClientId;

  // Sync pendingNetwork with actual network when modal opens
  useEffect(() => {
    if (isOpen) {
      setPendingNetwork(network);
    }
  }, [isOpen, network]);

  const handleNetworkChange = async (newNetwork: NetworkType) => {
    if (newNetwork === network) {
      setPendingNetwork(newNetwork);
      return;
    }

    // Switch network immediately - wallet selector will reinitialize via useEffect
    setPendingNetwork(newNetwork);
    switchNetwork(newNetwork);
  };

  const handleConnect = () => {
    if (!isWalletReady) {
      // Wallet selector is still reinitializing, don't connect yet
      return;
    }
    connect();
  };

  const handleGoogleSignIn = async () => {
    try {
      await connectWithGoogle();
    } catch (err) {
      console.error('Google sign-in failed:', err);
    }
  };

  // Already connected via NEAR wallet — show simple status
  if (isNearConnected) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>NEAR Wallet Connected</DialogTitle>
            <DialogDescription>
              Connected as <span className="font-mono">{nearAccountId}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" onClick={onClose} className="w-full">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {authMethod === 'google' ? 'Connect NEAR Wallet' : 'Connect Wallet'}
          </DialogTitle>
          <DialogDescription>
            {authMethod === 'google'
              ? 'Connect a NEAR wallet to sign transactions on-chain. Your Google session stays active.'
              : 'Select network and login with NEAR or Google'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Network Selector */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Network
            </label>
            <div className="flex items-center bg-muted rounded-lg p-1">
              <button
                onClick={() => handleNetworkChange('testnet')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  pendingNetwork === 'testnet'
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-muted-foreground'
                }`}
              >
                Testnet
              </button>
              <button
                onClick={() => handleNetworkChange('mainnet')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  pendingNetwork === 'mainnet'
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-muted-foreground'
                }`}
              >
                Mainnet
              </button>
            </div>
          </div>

          {/* Connect Button */}
          <Button
            onClick={handleConnect}
            disabled={!isWalletReady || pendingNetwork !== network}
            className="w-full h-11"
          >
            {!isWalletReady || pendingNetwork !== network ? 'Switching network...' : `Connect to ${pendingNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}`}
          </Button>

          {(!isWalletReady || pendingNetwork !== network) && (
            <p className="text-xs text-muted-foreground text-center">
              Please wait while we switch to {pendingNetwork}...
            </p>
          )}

          {/* Divider + Google Sign-In — only when not already connected via Google */}
          {showGoogleButton && authMethod !== 'google' && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-muted px-3 text-muted-foreground">or</span>
                </div>
              </div>

              <button
                onClick={handleGoogleSignIn}
                disabled={googleAuthLoading}
                className="w-full flex items-center justify-center gap-3 h-12 px-4 bg-white border border-border rounded-lg text-muted-foreground font-medium text-sm hover:bg-muted active:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {googleAuthLoading ? (
                  <svg className="animate-spin h-5 w-5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <GoogleLogo className="h-5 w-5 flex-shrink-0" />
                )}
                {googleAuthLoading ? 'Signing in...' : 'Sign in with Google'}
              </button>
            </>
          )}

          {/* Already Google-connected notice */}
          {authMethod === 'google' && (
            <p className="text-xs text-muted-foreground text-center">
              Already signed in with Google. This only adds a NEAR wallet for signing.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
