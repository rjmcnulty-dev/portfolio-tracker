import { useState } from 'react'
import { useWatchlist } from '../hooks/useWatchlist'
import WatchlistCard from '../components/WatchlistCard'
import WatchlistSyncModal from '../components/WatchlistSyncModal'

// Matches every other Twelve Data-backed job in this app (fetch-prices.mjs,
// the backfill script, evaluate-performance): free tier caps at 8 credits
// per rolling minute.
const MAX_TICKERS_PER_MINUTE = 8
const RATE_LIMIT_WINDOW_SECONDS = 61

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function countdown(totalSeconds, onTick) {
  for (let remaining = totalSeconds; remaining > 0; remaining--) {
    onTick(remaining)
    await wait(1000)
  }
}

export default function StockWatchPage() {
  const { watchlist, loading, error, addTicker, updateNotes, removeTicker } = useWatchlist()
  const [newTicker, setNewTicker] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)
  const [showSyncModal, setShowSyncModal] = useState(false)
  // Per-ticker instead of one shared object, so a metered range sync can
  // reveal itself to only the current batch of cards while the rest keep
  // their prior settings until their own turn comes up.
  const [syncMap, setSyncMap] = useState(new Map())
  const [syncStatus, setSyncStatus] = useState(null) // { batch, totalBatches, secondsUntilNext } | null

  function broadcast(tickers, settings) {
    setSyncMap((prev) => {
      const next = new Map(prev)
      for (const ticker of tickers) {
        const prevVersion = prev.get(ticker)?.version ?? 0
        next.set(ticker, { ...settings, version: prevVersion + 1 })
      }
      return next
    })
  }

  async function handleApplySync(settings) {
    const tickers = watchlist.map((item) => item.ticker)

    // No range change is always instant/free (indicator toggles are pure
    // client-side rendering) — apply to every card at once, no metering.
    if (settings.range === null) {
      broadcast(tickers, settings)
      return
    }

    const batches = []
    for (let i = 0; i < tickers.length; i += MAX_TICKERS_PER_MINUTE) {
      batches.push(tickers.slice(i, i + MAX_TICKERS_PER_MINUTE))
    }

    for (let i = 0; i < batches.length; i++) {
      broadcast(batches[i], settings)
      const isLastBatch = i === batches.length - 1
      if (!isLastBatch) {
        await countdown(RATE_LIMIT_WINDOW_SECONDS, (secondsUntilNext) => {
          setSyncStatus({ batch: i + 2, totalBatches: batches.length, secondsUntilNext })
        })
      }
    }
    setSyncStatus(null)
  }

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
          <button className="btn btn--ghost" disabled={Boolean(syncStatus)} onClick={() => setShowSyncModal(true)}>
            Sync All Charts
          </button>
        )}
      </header>

      {syncStatus && (
        <p className="page__sync-status">
          Refreshing Data… batch {syncStatus.batch - 1} of {syncStatus.totalBatches} done, next batch in{' '}
          {syncStatus.secondsUntilNext}s
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
        <div className="chart-grid">
          {watchlist.map((item) => (
            <WatchlistCard
              key={item.id}
              item={item}
              onRemove={removeTicker}
              onSaveNotes={updateNotes}
              syncSettings={syncMap.get(item.ticker)}
            />
          ))}
        </div>
      )}

      {showSyncModal && <WatchlistSyncModal onApply={handleApplySync} onClose={() => setShowSyncModal(false)} />}
    </div>
  )
}
