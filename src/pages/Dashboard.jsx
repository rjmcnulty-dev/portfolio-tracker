import { useState } from 'react'
import { usePortfolio } from '../hooks/usePortfolio'
import { useDateRange } from '../hooks/useDateRange'
import KPIRow from '../components/KPIRow'
import BenchmarkComparisonChart from '../components/BenchmarkComparisonChart'
import PortfolioValueChart from '../components/PortfolioValueChart'
import AllocationDonut from '../components/AllocationDonut'
import PnLBarChart from '../components/PnLBarChart'
import HoldingsSummaryTable from '../components/HoldingsSummaryTable'
import RealizedPnLTable from '../components/RealizedPnLTable'
import HoldingsTable from '../components/HoldingsTable'
import PerformanceEvaluator from '../components/PerformanceEvaluator'

export default function Dashboard() {
  const { trades, loading, error, kpis, allocation, pnlByTicker, holdings, cashPosition, deleteTrade } =
    usePortfolio('All')
  const [showEvaluator, setShowEvaluator] = useState(false)
  const dateRange = useDateRange()

  return (
    <div className="page">
      <header className="page__header page__header--row">
        <div>
          <h1>All Accounts</h1>
          <p className="page__subtitle">Consolidated view across Robinhood, Traditional IRA, and Roth IRA.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowEvaluator(true)}>
          Run Performance Evaluator
        </button>
      </header>

      {error && <p className="page__error">Error: {error}</p>}
      {loading ? (
        <p className="page__loading">Loading portfolio…</p>
      ) : (
        <>
          <KPIRow kpis={kpis} cashPosition={cashPosition} />
          <BenchmarkComparisonChart dateRange={dateRange} />
          <PortfolioValueChart dateRange={dateRange} />
          <div className="chart-grid">
            <AllocationDonut allocation={allocation} />
            <PnLBarChart data={pnlByTicker} />
          </div>
          <section className="page__section">
            <h2>Holdings</h2>
            <HoldingsSummaryTable holdings={holdings} />
          </section>
          <section className="page__section">
            <h2>Realized P&L</h2>
            <RealizedPnLTable trades={trades} />
          </section>
          <section className="page__section">
            <h2>Trade Detail</h2>
            <HoldingsTable trades={trades} onDelete={deleteTrade} />
          </section>
        </>
      )}

      {showEvaluator && (
        <PerformanceEvaluator holdings={holdings} title="All Accounts" onClose={() => setShowEvaluator(false)} />
      )}
    </div>
  )
}
