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

export default function WalletConnectionModal({ isOpen, onClose }: WalletConnectionModalProps) {
  const { network, switchNetwork, connect, isConnected, isWalletReady } = useNearWallet();
  const [pendingNetwork, setPendingNetwork] = useState<NetworkType>(network);

  // Sync pendingNetwork with actual network when modal opens
  useEffect(() => {
    if (isOpen) {
      setPendingNetwork(network);
    }
  }, [isOpen, network]);

  // Auto-close modal when wallet gets connected
  useEffect(() => {
    if (isConnected && isOpen) {
      onClose();
    }
  }, [isConnected, isOpen, onClose]);

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isConnected ? 'Wallet Connected' : 'Connect Wallet'}
          </DialogTitle>
          <DialogDescription>
            {isConnected
              ? 'Your wallet is already connected. Go to Settings to disconnect or switch network.'
              : 'Select network and login with NEAR'}
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="space-y-6">
            {/* Network Selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Network
              </label>
              <div className="flex items-center bg-zinc-100 rounded-lg p-1">
                <button
                  onClick={() => handleNetworkChange('testnet')}
                  className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    pendingNetwork === 'testnet'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  Testnet
                </button>
                <button
                  onClick={() => handleNetworkChange('mainnet')}
                  className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    pendingNetwork === 'mainnet'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
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
              <p className="text-xs text-zinc-400 text-center">
                Please wait while we switch to {pendingNetwork}...
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-zinc-600 text-sm">
              Your wallet is already connected. Go to Settings to disconnect or switch network.
            </p>
            <Button variant="outline" onClick={onClose} className="w-full">
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
