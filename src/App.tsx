import { lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import BottomNav from "./components/BottomNav";
import MobileHeader from "./components/MobileHeader";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ToastProvider";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import AnimatedGrid from "./components/AnimatedGrid";

// Code-split less-used pages
const HomePage = lazy(() => import("./pages/HomePage"));
const WalletManagePage = lazy(() => import("./pages/WalletManagePage"));
const WalletApprovalsPage = lazy(() => import("./pages/WalletApprovalsPage"));
const ApprovalDetailPage = lazy(() => import("./pages/ApprovalDetailPage"));
const WalletAuditPage = lazy(() => import("./pages/WalletAuditPage"));
const WalletHistoryPage = lazy(() => import("./pages/WalletHistoryPage"));
const WalletFundPage = lazy(() => import("./pages/WalletFundPage"));
const WalletSendPage = lazy(() => import("./pages/WalletSendPage"));
const WalletSwapPage = lazy(() => import("./pages/WalletSwapPage"));
const WalletPage = lazy(() => import("./pages/WalletPage"));

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
