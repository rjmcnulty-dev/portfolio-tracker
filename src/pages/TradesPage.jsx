import { useMemo, useState } from 'react'
import { usePortfolio } from '../hooks/usePortfolio'
import { ACCOUNTS } from '../lib/accounts'
import HoldingsTable from '../components/HoldingsTable'
import TradeForm from '../components/TradeForm'

export default function TradesPage() {
  const [accountFilter, setAccountFilter] = useState('All')
  const [tickerFilter, setTickerFilter] = useState('')
  const [editingTrade, setEditingTrade] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const { trades, loading, error, refetch, deleteTrade } = usePortfolio(accountFilter)

  const filteredTrades = useMemo(() => {
    if (!tickerFilter.trim()) return trades
    const needle = tickerFilter.trim().toUpperCase()
    return trades.filter((t) => t.ticker?.toUpperCase().includes(needle))
  }, [trades, tickerFilter])

  function openAddForm() {
    setEditingTrade(null)
    setShowForm(true)
  }

  function openEditForm(trade) {
    setEditingTrade(trade)
    setShowForm(true)
  }

  return (
    <div className="page">
      <header className="page__header page__header--row">
        <div>
          <h1>Trade Log</h1>
          <p className="page__subtitle">Full history of buys and sells across all accounts.</p>
        </div>
        <button className="btn btn--primary" onClick={openAddForm}>
          + Add Trade
        </button>
      </header>

      <div className="filters">
        <label>
          Account
          <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="All">All</option>
            {ACCOUNTS.map((a) => (
              <option key={a.slug} value={a.label}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ticker
          <input
            placeholder="Filter by ticker…"
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="page__error">Error: {error}</p>}
      {loading ? (
        <p className="page__loading">Loading trades…</p>
      ) : (
        <HoldingsTable
          trades={filteredTrades}
          showAccount={accountFilter === 'All'}
          onEdit={openEditForm}
          onDelete={deleteTrade}
        />
      )}

      {showForm && <TradeForm trade={editingTrade} onClose={() => setShowForm(false)} onSaved={refetch} />}
    </div>
  )
}
