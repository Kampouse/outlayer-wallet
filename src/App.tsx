import { Routes, Route } from 'react-router-dom'
import BottomNav from './components/BottomNav'
import WalletPage from './pages/WalletPage'
import WalletManagePage from './pages/WalletManagePage'
import WalletApprovalsPage from './pages/WalletApprovalsPage'
import ApprovalDetailPage from './pages/ApprovalDetailPage'
import WalletAuditPage from './pages/WalletAuditPage'
import WalletFundPage from './pages/WalletFundPage'

export default function App() {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50 text-gray-900">
      <main className="flex-1 pb-20">
        <Routes>
          <Route path="/" element={<WalletManagePage />} />
          <Route path="/wallet" element={<WalletManagePage />} />
          <Route path="/wallet/manage" element={<WalletManagePage />} />
          <Route path="/wallet/approvals" element={<WalletApprovalsPage />} />
          <Route path="/wallet/approvals/:id" element={<ApprovalDetailPage />} />
          <Route path="/wallet/audit" element={<WalletAuditPage />} />
          <Route path="/wallet/fund" element={<WalletFundPage />} />
          <Route path="/handoff" element={<WalletPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}
