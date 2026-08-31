import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePortfolio } from '../hooks/usePortfolio'
import { useAccounts } from '../hooks/useAccounts'
import { useDateRange } from '../hooks/useDateRange'
import { slugify } from '../lib/accounts'
import KPIRow from '../components/KPIRow'
import AccountTabs from '../components/AccountTabs'
import BenchmarkComparisonChart from '../components/BenchmarkComparisonChart'
import PortfolioValueChart from '../components/PortfolioValueChart'
import AllocationDonut from '../components/AllocationDonut'
import PnLBarChart from '../components/PnLBarChart'
import HoldingsSummaryTable from '../components/HoldingsSummaryTable'
import RealizedPnLTable from '../components/RealizedPnLTable'
import HoldingsTable from '../components/HoldingsTable'
import PerformanceEvaluator from '../components/PerformanceEvaluator'
import DailyGainsTable from '../components/DailyGainsTable'

// Both charts' default range would otherwise be the 'monthly' preset (a
// 365-day lookback), which for these two accounts lands well before their
// first deposit — that's exactly the near-zero-starting-value case that
// blows up simple % change into absurd numbers (see BenchmarkComparisonChart's
// caveat text). Pinning the default start to when the account was actually
// funded keeps the initial view meaningful; the user can still pick any
// other range from the chart's own selector.
const ACCOUNT_DEFAULT_START_DATES = {
  Robinhood: '2026-07-18',
  'Traditional IRA': '2026-07-01',
}

// Every account page matches the same route (/account/:accountSlug), so
// React Router reuses one AccountPage instance across tabs instead of
// remounting. Two things have to hold to avoid ever showing the wrong
// account's numbers:
//
// 1. usePortfolio must never be called with 'All' as a stand-in while we
//    don't yet know the real account name (e.g. while useAccounts is still
//    loading) — that used to kick off an unfiltered fetch that could
//    resolve *after* the correctly-scoped one and silently overwrite it
//    with cross-account data (the fetch hooks now also guard against this
//    directly, but not calling usePortfolio with the wrong account at all
//    is the real fix — this wrapper resolves accounts and the account name
//    first, and only mounts AccountPageContent once both are known).
// 2. Keying AccountPageContent by accountSlug forces a full remount on every
//    tab switch, so hook state always starts fresh instead of carrying over
//    from whichever account was previously showing.
export default function AccountPage() {
  const { accountSlug } = useParams()
  const { accounts, loading: accountsLoading } = useAccounts()

  if (accountsLoading) {
    return (
      <div className="page">
        <p className="page__loading">Loading account…</p>
      </div>
    )
  }

  const account = accounts.find((a) => slugify(a.name) === accountSlug)
  const accountLabel = account?.name ?? 'All'

  return <AccountPageContent key={accountSlug} accountLabel={accountLabel} />
}

function AccountPageContent({ accountLabel }) {
  const { trades, loading, error, kpis, allocation, pnlByTicker, holdings, cashPosition, deleteTrade } =
    usePortfolio(accountLabel)
  const [showEvaluator, setShowEvaluator] = useState(false)
  // Shared by both charts below so picking a range or custom date on either
  // one moves both together — see useDateRange.
  const dateRange = useDateRange('monthly', ACCOUNT_DEFAULT_START_DATES[accountLabel] ?? null)

  return (
    <div className="page">
      <header className="page__header page__header--row">
        <div>
          <h1>{accountLabel}</h1>
          <p className="page__subtitle">Positions and performance for this account only.</p>
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
          <AccountTabs
            tabs={[
              {
                key: 'benchmarks',
                label: 'Benchmarks',
                render: () => (
                  <BenchmarkComparisonChart account={accountLabel} title={`${accountLabel} vs. Benchmarks`} dateRange={dateRange} />
                ),
              },
              {
                key: 'value',
                label: 'Value',
                render: () => <PortfolioValueChart account={accountLabel} title={`${accountLabel} Value`} dateRange={dateRange} />,
              },
              {
                key: 'dailyGains',
                label: 'Daily Gains',
                render: () => <DailyGainsTable account={accountLabel} holdings={holdings} trades={trades} />,
              },
              {
                key: 'charts',
                label: 'Charts',
                render: () => (
                  <div className="chart-grid">
                    <AllocationDonut allocation={allocation} />
                    <PnLBarChart data={pnlByTicker} />
                  </div>
                ),
              },
              {
                key: 'holdings',
                label: 'Holdings',
                render: () => (
                  <section className="page__section">
                    <h2>Holdings</h2>
                    <HoldingsSummaryTable holdings={holdings} />
                  </section>
                ),
              },
              {
                key: 'realizedPnl',
                label: 'Realized P&L',
                render: () => (
                  <section className="page__section">
                    <h2>Realized P&L</h2>
                    <RealizedPnLTable trades={trades} />
                  </section>
                ),
              },
              {
                key: 'tradeDetail',
                label: 'Trade Detail',
                render: () => (
                  <section className="page__section">
                    <h2>Trade Detail</h2>
                    <HoldingsTable trades={trades} onDelete={deleteTrade} />
                  </section>
                ),
              },
            ]}
          />
        </>
      )}

      {showEvaluator && (
        <PerformanceEvaluator holdings={holdings} title={accountLabel} onClose={() => setShowEvaluator(false)} />
      )}
    </div>
  )
}
