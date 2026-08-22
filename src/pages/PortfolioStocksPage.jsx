import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { usePortfolio } from '../hooks/usePortfolio'
import { useTwelveDataQueueStatus } from '../hooks/useTwelveDataQueueStatus'
import { isBuyTrade } from '../lib/tradeTypes'
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
  const { holdings, trades, loading, error } = usePortfolio(accountLabel)
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
  // and nowhere to persist a note against it here. Alphabetical by ticker,
  // not `holdings`' own market-value-descending order — matches Stock
  // Watch, where the watchlist query is already sorted this way.
  const items = useMemo(
    () =>
      holdings
        .map((h) => ({ id: h.ticker, ticker: h.ticker }))
        .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [holdings],
  )
  const visibleItems = items.filter((item) => !hiddenTickers.has(item.ticker))

  // Feeds each card's $ buy/sell markers on the price chart (see
  // WatchlistCard's `trades` prop) — Stock Watch doesn't have an
  // equivalent, since a watched ticker isn't necessarily a real position.
  const tradesByTicker = useMemo(() => {
    const map = new Map()
    for (const trade of trades) {
      if (!map.has(trade.ticker)) map.set(trade.ticker, [])
      map.get(trade.ticker).push(trade)
    }
    return map
  }, [trades])

  // Per (ticker, account) quantity/P&L — same remaining_quantity/
  // remaining_cost_basis/market_value/realized_pnl fields usePortfolio's own
  // `holdings`/`pnlByTicker` use, just grouped by account too instead of
  // combined across whichever account(s) the current tab covers. realizedPnl
  // accumulates across every trade for that (ticker, account) — including
  // ones that no longer hold shares — but the final result is still filtered
  // to quantity > 0, so a fully-sold-off account doesn't show a phantom
  // "0 sh" row; totalPnl (realized + unrealized) is what actually answers
  // "how has this account done on this ticker overall," not just its current
  // open position. Feeds each card's account-by-account breakdown (see
  // WatchlistCard's `accountHoldings` prop) — still useful even on a
  // single-account tab, not just "All".
  const accountHoldingsByTicker = useMemo(() => {
    const byTicker = new Map()
    for (const trade of trades) {
      if (!byTicker.has(trade.ticker)) byTicker.set(trade.ticker, new Map())
      const byAccount = byTicker.get(trade.ticker)
      const entry = byAccount.get(trade.account) || {
        account: trade.account,
        quantity: 0,
        costBasis: 0,
        marketValue: 0,
        realizedPnl: 0,
      }
      entry.realizedPnl += Number(trade.realized_pnl) || 0
      if (isBuyTrade(trade.trade_type)) {
        entry.quantity += Number(trade.remaining_quantity) || 0
        entry.costBasis += Number(trade.remaining_cost_basis) || 0
        entry.marketValue += Number(trade.market_value) || 0
      }
      byAccount.set(trade.account, entry)
    }

    const result = new Map()
    for (const [ticker, byAccount] of byTicker) {
      result.set(
        ticker,
        [...byAccount.values()]
          .filter((entry) => entry.quantity > 0)
          .map((entry) => {
            const unrealizedPnl = entry.marketValue - entry.costBasis
            return { ...entry, unrealizedPnl, totalPnl: unrealizedPnl + entry.realizedPnl }
          })
          .sort((a, b) => a.account.localeCompare(b.account)),
      )
    }
    return result
  }, [trades])

  // useCallback everywhere below, matched with WatchlistCard's React.memo —
  // useTwelveDataQueueStatus forces this page to re-render once a second
  // while anything's queued, and without stable prop references every
  // card (and its Recharts trees) would re-render/re-paint right along
  // with it, which is exactly the "chart lines feel laggy" symptom this
  // was built to fix.
  const handleToggleAllSubcharts = useCallback(() => {
    setSubchartsBroadcast((prev) => ({ visible: !prev.visible, version: prev.version + 1 }))
  }, [])

  const handleHide = useCallback((ticker) => {
    setHiddenTickers((prev) => new Set(prev).add(ticker))
  }, [])

  const handleToggleTicker = useCallback((ticker) => {
    setHiddenTickers((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }, [])

  const handleApplySync = useCallback(
    (settings) => {
      setSyncMap((prev) => {
        const next = new Map(prev)
        for (const item of items) {
          const prevVersion = prev.get(item.ticker)?.version ?? 0
          next.set(item.ticker, { ...settings, version: prevVersion + 1 })
        }
        return next
      })
    },
    [items],
  )

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
                    trades={tradesByTicker.get(item.ticker)}
                    accountHoldings={accountHoldingsByTicker.get(item.ticker)}
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
