import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Dashboard from './pages/Dashboard'
import AccountPage from './pages/AccountPage'
import TaxPage from './pages/TaxPage'
import TradesPage from './pages/TradesPage'
import PricesPage from './pages/PricesPage'
import DepositsPage from './pages/DepositsPage'
import StockWatchPage from './pages/StockWatchPage'
import PortfolioStocksPage from './pages/PortfolioStocksPage'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'
import AiCompanionPage from './pages/AiCompanionPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import { usePasswordRecovery } from './hooks/usePasswordRecovery'

export default function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}

function AppRoutes() {
  const [passwordRecovery, setPasswordRecovery] = usePasswordRecovery()
  const navigate = useNavigate()

  // Takes over the whole app the instant a recovery session is detected,
  // regardless of the current URL — see usePasswordRecovery for why this
  // can't be a normal matched route.
  if (passwordRecovery) {
    return (
      <ResetPasswordPage
        onDone={() => {
          setPasswordRecovery(false)
          navigate('/admin', { replace: true })
        }}
      />
    )
  }

  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="account/:accountSlug" element={<AccountPage />} />
        <Route path="trades" element={<TradesPage />} />
        <Route path="prices" element={<PricesPage />} />
        <Route path="deposits" element={<DepositsPage />} />
        <Route path="watch" element={<StockWatchPage />} />
        <Route path="portfolio-stocks" element={<PortfolioStocksPage />} />
        <Route path="tax" element={<TaxPage />} />
        <Route element={<RequireAuth />}>
          <Route path="admin" element={<AdminPage />} />
          <Route path="ai-companion" element={<AiCompanionPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
