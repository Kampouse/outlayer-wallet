import { lazy, Suspense, type ComponentType } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import BottomNav from "./components/BottomNav";
import MobileHeader from "./components/MobileHeader";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ToastProvider";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import AnimatedGrid from "./components/AnimatedGrid";

// Wrap lazy() so that if a chunk fails to load (stale cached HTML referencing
// an old hash after a deploy), we do a full page reload to pick up the new
// index.html with fresh chunk hashes.
function lazyReload<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err) => {
      // Only reload once per session to avoid infinite loops
      const key = "outlayer_chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
      }
      throw err;
    }),
  );
}

// Code-split less-used pages
const HomePage = lazyReload(() => import("./pages/HomePage"));
const WalletManagePage = lazyReload(() => import("./pages/WalletManagePage"));
const WalletApprovalsPage = lazyReload(() => import("./pages/WalletApprovalsPage"));
const ApprovalDetailPage = lazyReload(() => import("./pages/ApprovalDetailPage"));
const WalletAuditPage = lazyReload(() => import("./pages/WalletAuditPage"));
const WalletHistoryPage = lazyReload(() => import("./pages/WalletHistoryPage"));
const WalletFundPage = lazyReload(() => import("./pages/WalletFundPage"));
const WalletSendPage = lazyReload(() => import("./pages/WalletSendPage"));
const WalletSwapPage = lazyReload(() => import("./pages/WalletSwapPage"));
const WalletPrivatePage = lazyReload(() => import("./pages/WalletPrivatePage"));
const WalletPage = lazyReload(() => import("./pages/WalletPage"));

function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-in">
      {children}
    </div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <div className="flex flex-col min-h-screen text-foreground">
      <AnimatedGrid />
      <MobileHeader />
      <main className="flex-1 pb-20 pt-0 relative z-10">
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="flex items-center justify-center min-h-[40vh]">
                <div className="w-5 h-5 border-2 border-muted border-t-foreground rounded-full animate-spin" />
              </div>
            }
          >
            <PageTransition key={location.pathname}>
              <Routes location={location}>
                <Route path="/" element={<HomePage />} />
                <Route path="/wallet" element={<HomePage />} />
                <Route path="/wallet/manage" element={<WalletManagePage />} />
                <Route path="/wallet/send" element={<WalletSendPage />} />
                <Route path="/wallet/swap" element={<WalletSwapPage />} />
                <Route path="/wallet/approvals" element={<WalletApprovalsPage />} />
                <Route path="/wallet/approvals/:id" element={<ApprovalDetailPage />} />
                <Route path="/wallet/audit" element={<WalletAuditPage />} />
                <Route path="/wallet/history" element={<WalletHistoryPage />} />
                <Route path="/wallet/fund" element={<WalletFundPage />} />
                <Route path="/wallet/private" element={<WalletPrivatePage />} />
                <Route path="/handoff" element={<WalletPage />} />
              </Routes>
            </PageTransition>
          </Suspense>
        </ErrorBoundary>
      </main>
      <PWAInstallPrompt />
      <BottomNav />
      <ToastProvider />
    </div>
  );
}
