import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('pwa-dismissed')) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setShow(false);
      sessionStorage.setItem('pwa-dismissed', '1');
    };
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      sessionStorage.setItem('pwa-dismissed', '1');
    }
    setShow(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    sessionStorage.setItem('pwa-dismissed', '1');
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-16 left-3 right-3 z-50 bg-muted text-foreground rounded-lg p-3 flex items-center justify-between gap-3 shadow-lg border border-border">
      <span className="text-sm text-muted-foreground">
        Install OutLayer Wallet for quick access
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleInstall}
          className="text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white px-3 py-1.5 rounded-md transition-colors"
        >
          Install app
        </button>
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors px-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
