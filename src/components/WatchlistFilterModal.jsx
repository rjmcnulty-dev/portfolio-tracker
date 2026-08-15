import { useState } from 'react'
import './WatchlistFilterModal.css'

// hiddenTickers is a Set (empty by default — nothing hidden, everything
// shown) rather than an allow-list, so a newly-added ticker is visible
// automatically instead of silently starting hidden. Local checkbox state
// here means Cancel discards any changes; only Apply commits them.
export default function WatchlistFilterModal({ watchlist, hiddenTickers, onApply, onClose }) {
  const [hidden, setHidden] = useState(() => new Set(hiddenTickers))

  function toggleTicker(ticker) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  function handleApply() {
    onApply(hidden)
    onClose()
  }

  const visibleCount = watchlist.length - hidden.size

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">Filter Cards</h2>
        <p className="watchlist-filter-modal__hint">
          Uncheck a ticker to hide its card on this page — it stays on your watchlist, and
          nothing here changes what's fetched for it once it's shown again.
        </p>

        <div className="watchlist-filter-modal__actions">
          <button type="button" className="btn-link" onClick={() => setHidden(new Set())}>
            Select All
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => setHidden(new Set(watchlist.map((item) => item.ticker)))}
          >
            Deselect All
          </button>
        </div>

        <ul className="watchlist-filter-modal__list">
          {watchlist.map((item) => (
            <li key={item.id} className="watchlist-filter-modal__item">
              <label>
                <input
                  type="checkbox"
                  checked={!hidden.has(item.ticker)}
                  onChange={() => toggleTicker(item.ticker)}
                />
                <span>{item.ticker}</span>
              </label>
            </li>
          ))}
        </ul>

        <p className="watchlist-filter-modal__summary">
          {visibleCount} of {watchlist.length} card{watchlist.length === 1 ? '' : 's'} shown
        </p>

        <div className="trade-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
