import { useParams } from 'react-router-dom'
import { usePortfolio } from '../hooks/usePortfolio'
import { accountLabelFromSlug } from '../lib/accounts'
import KPIRow from '../components/KPIRow'
import AllocationDonut from '../components/AllocationDonut'
import PnLBarChart from '../components/PnLBarChart'
import HoldingsSummaryTable from '../components/HoldingsSummaryTable'
import HoldingsTable from '../components/HoldingsTable'

export default function AccountPage() {
  const { accountSlug } = useParams()
  const accountLabel = accountLabelFromSlug(accountSlug)
  const { trades, loading, error, kpis, allocation, pnlByTicker, holdings, deleteTrade } = usePortfolio(accountLabel)

  return (
    <div className="page">
      <header className="page__header">
        <h1>{accountLabel}</h1>
        <p className="page__subtitle">Positions and performance for this account only.</p>
      </header>

      {error && <p className="page__error">Error: {error}</p>}
      {loading ? (
        <p className="page__loading">Loading portfolio…</p>
      ) : (
        <>
          <KPIRow kpis={kpis} />
          <div className="chart-grid">
            <AllocationDonut allocation={allocation} />
            <PnLBarChart data={pnlByTicker} />
          </div>
          <section className="page__section">
            <h2>Holdings</h2>
            <HoldingsSummaryTable holdings={holdings} />
          </section>
          <section className="page__section">
            <h2>Trade Detail</h2>
            <HoldingsTable trades={trades} showAccount={false} onDelete={deleteTrade} />
          </section>
        </>
      )}
    </div>
  )
}
