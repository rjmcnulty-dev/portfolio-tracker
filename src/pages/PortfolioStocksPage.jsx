import { useEffect, useMemo, useState } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { usePortfolio } from '../hooks/usePortfolio'
import { useTwelveDataQueueStatus } from '../hooks/useTwelveDataQueueStatus'
import WatchlistCard from '../components/WatchlistCard'
import WatchlistSyncModal from '../components/WatchlistSyncModal'
import TickerChecklist from '../components/TickerChecklist'
import '../components/PortfolioStocksTabs.css'

// Tabs are just `accounts` plus a leading "All" pseudo-tab, so they always
// track whatever accounts currently exist — no separate config to keep in
// sync when an account is added/removed on the Manage Accounts form.
export default function PortfolioStocksPage() {
  const { accounts, loading: accountsLoading, error: accountsError } = useAccounts()
  const [activeAccount, setActiveAccount] = useState('All')

  // If the account backing the current tab gets deleted out from under it,
  // fall back to "All" rather than rendering a now-nonexistent tab's content.
  useEffect(() => {
    if (activeAccount === 'All') return
    if (!accounts.some((a) => a.name === activeAccount)) setActiveAccount('All')
  }, [accounts, activeAccount])

  return (
    <div className="page">
      <header className="page__header">
        <h1>Portfolio Stocks</h1>
        <p className="page__subtitle">
          Every ticker currently held, charted with the same tools as Stock Watch — one tab per account.
        </p>
      </header>

      {accountsError && <p className="page__error">Accounts failed to load: {accountsError}</p>}

      {accountsLoading ? (
        <p className="page__loading">Loading accounts…</p>
      ) : (
        <>
          <div className="portfolio-stocks-tabs">
            <button
              className={`portfolio-stocks-tabs__btn ${activeAccount === 'All' ? 'is-active' : ''}`}
              onClick={() => setActiveAccount('All')}
            >
              All
            </button>
            {accounts.map((account) => (
              <button
                key={account.id}
                className={`portfolio-stocks-tabs__btn ${activeAccount === account.name ? 'is-active' : ''}`}
                onClick={() => setActiveAccount(account.name)}
              >
                {account.name}
              </button>
            ))}
          </div>

          {/* Keyed by tab so switching accounts starts every card, hidden
              set, and sync state fresh instead of carrying over from
              whichever account was previously showing. */}
          <PortfolioStocksTab key={activeAccount} accountLabel={activeAccount} />
        </>
      )}
    </div>
  )
}

function PortfolioStocksTab({ accountLabel }) {
  const { holdings, loading, error } = usePortfolio(accountLabel)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [hiddenTickers, setHiddenTickers] = useState(new Set())
  const [syncMap, setSyncMap] = useState(new Map())
  const [subchartsBroadcast, setSubchartsBroadcast] = useState({ version: 0, visible: true })

  const queueStatus = useTwelveDataQueueStatus()
  const secondsUntilNextWindow = queueStatus.windowEndsAt
    ? Math.max(0, Math.ceil((queueStatus.windowEndsAt - Date.now()) / 1000))
    : 0

  // Cards need only {id, ticker} — WatchlistCard's Notes/Remove UI is
  // omitted entirely below (no onSaveNotes/onRemove passed) since a holding
  // isn't a watchlist row: there's nothing to remove (it's a real position)
  // and nowhere to persist a note against it here.
  const items = useMemo(() => holdings.map((h) => ({ id: h.ticker, ticker: h.ticker })), [holdings])
  const visibleItems = items.filter((item) => !hiddenTickers.has(item.ticker))

  function handleToggleAllSubcharts() {
    setSubchartsBroadcast((prev) => ({ visible: !prev.visible, version: prev.version + 1 }))
  }

  function handleHide(ticker) {
    setHiddenTickers((prev) => new Set(prev).add(ticker))
  }

  function handleToggleTicker(ticker) {
    setHiddenTickers((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  function handleApplySync(settings) {
    setSyncMap((prev) => {
      const next = new Map(prev)
      for (const item of items) {
        const prevVersion = prev.get(item.ticker)?.version ?? 0
        next.set(item.ticker, { ...settings, version: prevVersion + 1 })
      }
      return next
    })
  }

  return (
    <>
      {items.length > 0 && (
        <div className="filters">
          <button className="btn btn--ghost" onClick={handleToggleAllSubcharts}>
            {subchartsBroadcast.visible ? 'Hide All Subcharts' : 'Show All Subcharts'}
          </button>
          <button className="btn btn--ghost" onClick={() => setShowSyncModal(true)}>
            Sync All Charts
          </button>
        </div>
      )}

      {queueStatus.queued > 0 && (
        <p className="page__sync-status">
          Refreshing Data… {queueStatus.queued} chart{queueStatus.queued === 1 ? '' : 's'} waiting, next available in{' '}
          {secondsUntilNextWindow}s
        </p>
      )}

      {error && <p className="page__error">Error: {error}</p>}
      {loading ? (
        <p className="page__loading">Loading holdings…</p>
      ) : items.length === 0 ? (
        <p className="page__loading">No holdings in {accountLabel === 'All' ? 'any account' : accountLabel}.</p>
      ) : (
        <div className="page__split">
          <TickerChecklist
            items={items}
            hiddenTickers={hiddenTickers}
            onToggle={handleToggleTicker}
            onSelectAll={() => setHiddenTickers(new Set())}
            onDeselectAll={() => setHiddenTickers(new Set(items.map((item) => item.ticker)))}
          />
          <div className="page__split-main">
            {visibleItems.length === 0 ? (
              <p className="page__loading">Every card is hidden — check a ticker on the left to show it.</p>
            ) : (
              <div className="chart-grid">
                {visibleItems.map((item) => (
                  <WatchlistCard
                    key={item.id}
                    item={item}
                    onHide={handleHide}
                    syncSettings={syncMap.get(item.ticker)}
                    subchartsBroadcast={subchartsBroadcast}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showSyncModal && <WatchlistSyncModal onApply={handleApplySync} onClose={() => setShowSyncModal(false)} />}
    </>
  )
}
