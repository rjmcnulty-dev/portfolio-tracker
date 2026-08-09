import { usePortfolio } from '../hooks/usePortfolio'
import KPIRow from '../components/KPIRow'
import PortfolioValueChart from '../components/PortfolioValueChart'
import AllocationDonut from '../components/AllocationDonut'
import PnLBarChart from '../components/PnLBarChart'
import HoldingsSummaryTable from '../components/HoldingsSummaryTable'
import HoldingsTable from '../components/HoldingsTable'

export default function Dashboard() {
  const { trades, loading, error, kpis, allocation, pnlByTicker, holdings, cashPosition, deleteTrade } =
    usePortfolio('All')

  return (
    <div className="page">
      <header className="page__header">
        <h1>All Accounts</h1>
        <p className="page__subtitle">Consolidated view across Robinhood, Traditional IRA, and Roth IRA.</p>
      </header>

      {error && <p className="page__error">Error: {error}</p>}
      {loading ? (
        <p className="page__loading">Loading portfolio…</p>
      ) : (
        <>
          <KPIRow kpis={kpis} cashPosition={cashPosition} />
          <PortfolioValueChart />
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
            <HoldingsTable trades={trades} onDelete={deleteTrade} />
          </section>
        </>
      )}
    </div>
  )
}
