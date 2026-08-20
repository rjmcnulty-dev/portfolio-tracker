import { HashRouter, Route, Routes } from 'react-router-dom'
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

export default function App() {
  return (
    <HashRouter>
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
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  )
}
