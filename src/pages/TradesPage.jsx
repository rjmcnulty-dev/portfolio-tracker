import { useMemo, useState } from 'react'
import { usePortfolio } from '../hooks/usePortfolio'
import { useTradeSchedules } from '../hooks/useTradeSchedules'
import { useAccounts } from '../hooks/useAccounts'
import HoldingsTable from '../components/HoldingsTable'
import TradeForm from '../components/TradeForm'
import TradeSchedulesTable from '../components/TradeSchedulesTable'
import TradeScheduleForm from '../components/TradeScheduleForm'

export default function TradesPage() {
  const [accountFilter, setAccountFilter] = useState('All')
  const [tickerFilter, setTickerFilter] = useState('')
  const [editingTrade, setEditingTrade] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [syncMessage, setSyncMessage] = useState(null)

  const { accounts } = useAccounts()
  const { trades, loading, error, refetch, deleteTrade } = usePortfolio(accountFilter)

  const {
    schedules,
    loading: schedulesLoading,
    error: schedulesError,
    refetch: refetchSchedules,
    deleteSchedule,
    materializeNow,
  } = useTradeSchedules(accountFilter)

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

  function openAddSchedule() {
    setEditingSchedule(null)
    setShowScheduleForm(true)
  }

  function openEditSchedule(schedule) {
    setEditingSchedule(schedule)
    setShowScheduleForm(true)
  }

  async function handleSyncNow() {
    setSyncing(true)
    setSyncError(null)
    setSyncMessage(null)
    try {
      const result = await materializeNow()
      setSyncMessage(result?.message ?? 'Recurring trades synced.')
      await refetch()
    } catch (err) {
      setSyncError(err.message)
    } finally {
      setSyncing(false)
    }
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
            {accounts.map((a) => (
              <option key={a.id} value={a.name}>
                {a.name}
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

      <section className="page__section">
        <header className="page__header page__header--row">
          <h2>Recurring Trades</h2>
          <div className="filters">
            <button className="btn btn--ghost" disabled={syncing} onClick={handleSyncNow}>
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            <button className="btn btn--primary" onClick={openAddSchedule}>
              + Add Recurring Trade
            </button>
          </div>
        </header>
        {syncError && <p className="page__error">{syncError}</p>}
        {syncMessage && !syncError && <p className="success-message">{syncMessage}</p>}
        {schedulesError && <p className="page__error">Error: {schedulesError}</p>}
        {schedulesLoading ? (
          <p className="page__loading">Loading schedules…</p>
        ) : (
          <TradeSchedulesTable
            schedules={schedules}
            trades={trades}
            showAccount={accountFilter === 'All'}
            onEdit={openEditSchedule}
            onDelete={deleteSchedule}
          />
        )}
      </section>

      <section className="page__section">
        <h2>All Trades</h2>
        {error && <p className="page__error">Error: {error}</p>}
        {loading ? (
          <p className="page__loading">Loading trades…</p>
        ) : (
          <HoldingsTable trades={filteredTrades} onEdit={openEditForm} onDelete={deleteTrade} />
        )}
      </section>

      {showForm && <TradeForm trade={editingTrade} onClose={() => setShowForm(false)} onSaved={refetch} />}
      {showScheduleForm && (
        <TradeScheduleForm
          schedule={editingSchedule}
          onClose={() => setShowScheduleForm(false)}
          onSaved={refetchSchedules}
        />
      )}
    </div>
  )
}
