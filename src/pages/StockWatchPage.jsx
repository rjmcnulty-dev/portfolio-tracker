import { useState } from 'react'
import { useWatchlist } from '../hooks/useWatchlist'
import WatchlistCard from '../components/WatchlistCard'

export default function StockWatchPage() {
  const { watchlist, loading, error, addTicker, updateNotes, removeTicker } = useWatchlist()
  const [newTicker, setNewTicker] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)

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
      <header className="page__header">
        <h1>Stock Watch</h1>
        <p className="page__subtitle">
          Track any ticker's price history and next earnings date — no need to hold it in a portfolio.
        </p>
      </header>

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
            <WatchlistCard key={item.id} item={item} onRemove={removeTicker} onSaveNotes={updateNotes} />
          ))}
        </div>
      )}
    </div>
  )
}
