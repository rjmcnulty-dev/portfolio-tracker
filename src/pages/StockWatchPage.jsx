import { useCallback, useMemo, useState } from 'react'
import { useWatchlist } from '../hooks/useWatchlist'
import { useTwelveDataQueueStatus } from '../hooks/useTwelveDataQueueStatus'
import { useHeldAccountsByTicker } from '../hooks/useHeldAccountsByTicker'
import WatchlistCard from '../components/WatchlistCard'
import WatchlistSyncModal from '../components/WatchlistSyncModal'
import TickerChecklist from '../components/TickerChecklist'

// Stable fallback reference — `?? []` would create a new array every
// render, which would defeat WatchlistCard's React.memo for any ticker
// with no held accounts just as surely as not memoizing at all.
const EMPTY_ARRAY = []

export default function StockWatchPage() {
  const { watchlist, loading, error, addTicker, updateNotes, removeTicker } = useWatchlist()
  const { heldAccountsByTicker } = useHeldAccountsByTicker()
  const [newTicker, setNewTicker] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)
  const [showSyncModal, setShowSyncModal] = useState(false)
  // Empty by default — nothing hidden — so a newly-added ticker is always
  // visible immediately rather than silently starting out hidden. Purely a
  // display filter: hiding a card doesn't touch the watchlist itself, and
  // an unmounted (hidden) card's useStockQuote doesn't fetch anything.
  const [hiddenTickers, setHiddenTickers] = useState(new Set())
  // Per-ticker rather than one shared object, purely so each card's own
  // useEffect only re-applies when ITS entry's version changes.
  const [syncMap, setSyncMap] = useState(new Map())
  // A single shared object (not per-ticker like syncMap above) is fine here
  // — every card is meant to react identically to this one, unlike the full
  // Sync modal, which doesn't need per-card version isolation.
  const [subchartsBroadcast, setSubchartsBroadcast] = useState({ version: 0, visible: true })

  // Every fetch — initial mount, a manual range click, the per-card Refresh
  // button, or this page's Sync modal — now goes through the same shared
  // rate-limit queue (src/lib/twelveDataQueue.js), so applying a sync to
  // every card at once is safe: whichever fetches it triggers get paced to
  // Twelve Data's 8-credits/minute cap automatically, same as everything
  // else on this page.
  const queueStatus = useTwelveDataQueueStatus()
  const secondsUntilNextWindow = queueStatus.windowEndsAt
    ? Math.max(0, Math.ceil((queueStatus.windowEndsAt - Date.now()) / 1000))
    : 0

  // Toggles every subchart (Stochastic, OBV, and any future ones) on every
  // card at once, without touching range/MA/levels/earnings — see
  // WatchlistCard's separate subchartsBroadcast effect.
  // useCallback everywhere below, matched with WatchlistCard's React.memo —
  // useTwelveDataQueueStatus forces this page to re-render once a second
  // while anything's queued, and without stable prop references every
  // card (and its Recharts trees) would re-render/re-paint right along
  // with it, which is exactly the "chart lines feel laggy" symptom this
  // was built to fix.
  const handleToggleAllSubcharts = useCallback(() => {
    setSubchartsBroadcast((prev) => ({ visible: !prev.visible, version: prev.version + 1 }))
  }, [])

  // Same hiddenTickers Set the checklist on the left reads/writes — a
  // card's own Hide button and the checklist are just two entry points to
  // the one source of truth, so they can never drift out of sync.
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
      const tickers = watchlist.map((item) => item.ticker)
      setSyncMap((prev) => {
        const next = new Map(prev)
        for (const ticker of tickers) {
          const prevVersion = prev.get(ticker)?.version ?? 0
          next.set(ticker, { ...settings, version: prevVersion + 1 })
        }
        return next
      })
    },
    [watchlist],
  )

  const visibleWatchlist = watchlist.filter((item) => !hiddenTickers.has(item.ticker))

  // Arrays, converted from heldAccountsByTicker's Sets once per ticker
  // (not inline in JSX below) — a fresh `[...set]` on every render would
  // give WatchlistCard a new heldAccounts array reference each time,
  // breaking its React.memo even when nothing about this ticker changed.
  const heldAccountsArrayByTicker = useMemo(() => {
    const map = new Map()
    for (const [ticker, accounts] of heldAccountsByTicker) {
      map.set(ticker, [...accounts])
    }
    return map
  }, [heldAccountsByTicker])

  async function handleAdd(event) {
    event.preventDefault()
    if (!newTicker.trim()) return

    setAdding(true)
    setAddError(null)
    try {
      await addTicker(newTicker)
      setNewTicker('')
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="page">
      <header className="page__header page__header--row">
        <div>
          <h1>Stock Watch</h1>
          <p className="page__subtitle">
            Track any ticker's price history and next earnings date — no need to hold it in a portfolio.
          </p>
        </div>
        {watchlist.length > 0 && (
          <div className="filters">
            <button className="btn btn--ghost" onClick={handleToggleAllSubcharts}>
              {subchartsBroadcast.visible ? 'Hide All Subcharts' : 'Show All Subcharts'}
            </button>
            <button className="btn btn--ghost" onClick={() => setShowSyncModal(true)}>
              Sync All Charts
            </button>
          </div>
        )}
      </header>

      {queueStatus.queued > 0 && (
        <p className="page__sync-status">
          Refreshing Data… {queueStatus.queued} chart{queueStatus.queued === 1 ? '' : 's'} waiting, next available in{' '}
          {secondsUntilNextWindow}s
        </p>
      )}

      <form className="filters" onSubmit={handleAdd}>
        <label>
          Ticker
          <input placeholder="e.g. AAPL" value={newTicker} onChange={(e) => setNewTicker(e.target.value)} />
        </label>
        <button className="btn btn--primary" type="submit" disabled={adding}>
          {adding ? 'Adding…' : '+ Add to Watchlist'}
        </button>
      </form>
      {addError && <p className="page__error">{addError}</p>}

      {error && <p className="page__error">Error: {error}</p>}
      {loading ? (
        <p className="page__loading">Loading watchlist…</p>
      ) : watchlist.length === 0 ? (
        <p className="page__loading">No tickers yet — add one above.</p>
      ) : (
        <div className="page__split">
          <TickerChecklist
            items={watchlist}
            hiddenTickers={hiddenTickers}
            onToggle={handleToggleTicker}
            onSelectAll={() => setHiddenTickers(new Set())}
            onDeselectAll={() => setHiddenTickers(new Set(watchlist.map((item) => item.ticker)))}
          />
          <div className="page__split-main">
            {visibleWatchlist.length === 0 ? (
              <p className="page__loading">Every card is hidden — check a ticker on the left to show it.</p>
            ) : (
              <div className="chart-grid">
                {visibleWatchlist.map((item) => (
                  <WatchlistCard
                    key={item.id}
                    item={item}
                    onRemove={removeTicker}
                    onHide={handleHide}
                    onSaveNotes={updateNotes}
                    syncSettings={syncMap.get(item.ticker)}
                    subchartsBroadcast={subchartsBroadcast}
                    heldAccounts={heldAccountsArrayByTicker.get(item.ticker) ?? EMPTY_ARRAY}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showSyncModal && <WatchlistSyncModal onApply={handleApplySync} onClose={() => setShowSyncModal(false)} />}
    </div>
  )
}
