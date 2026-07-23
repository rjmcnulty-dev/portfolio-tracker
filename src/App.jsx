import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import AccountPage from './pages/AccountPage'
import TaxPage from './pages/TaxPage'
import TradesPage from './pages/TradesPage'
import PricesPage from './pages/PricesPage'
import DepositsPage from './pages/DepositsPage'
import StockWatchPage from './pages/StockWatchPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="account/:accountSlug" element={<AccountPage />} />
          <Route path="trades" element={<TradesPage />} />
          <Route path="prices" element={<PricesPage />} />
          <Route path="deposits" element={<DepositsPage />} />
          <Route path="watch" element={<StockWatchPage />} />
          <Route path="tax" element={<TaxPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
