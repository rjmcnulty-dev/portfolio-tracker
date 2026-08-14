import { useState } from 'react'
import { RANGES, LEVEL_COUNTS } from './WatchlistCard'
import './WatchlistSyncModal.css'

// One-time broadcast, not a permanent link: picks a set of chart-control
// values here, and "Apply to All" pushes them into every WatchlistCard's
// independent local state once (see WatchlistCard's syncSettings effect).
// Each card stays individually adjustable afterward.
// null range means "leave each card's own range alone" — the default, since
// changing range is the only thing that can trigger a fresh Twelve Data
// fetch (indicator toggles are pure client-side rendering of data already
// fetched, so they never cost an API call regardless of range).
export default function WatchlistSyncModal({ onApply, onClose }) {
  const [range, setRange] = useState(null)
  const [showSMA20, setShowSMA20] = useState(true)
  const [showSMA50, setShowSMA50] = useState(true)
  const [showSMA200, setShowSMA200] = useState(true)
  const [showLevels, setShowLevels] = useState(true)
  const [levelCount, setLevelCount] = useState(2)

  const indicatorToggles = [
    { key: 'sma20', label: 'MA 20', show: showSMA20, setShow: setShowSMA20 },
    { key: 'sma50', label: 'MA 50', show: showSMA50, setShow: setShowSMA50 },
    { key: 'sma200', label: 'MA 200', show: showSMA200, setShow: setShowSMA200 },
    { key: 'levels', label: 'Support / Resistance', show: showLevels, setShow: setShowLevels },
  ]

  function handleApply() {
    onApply({ range, showSMA20, showSMA50, showSMA200, showLevels, levelCount })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal watchlist-sync-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">Sync All Charts</h2>
        <p className="watchlist-sync-modal__hint">
          Applies these settings to every card on the watchlist right now — each card stays
          independently adjustable afterward.
        </p>

        <div className="watchlist-sync-modal__section">
          <span className="watchlist-sync-modal__label">Range</span>
          <div className="watchlist-card__ranges">
            <button
              type="button"
              className={`range-btn ${range === null ? 'range-btn--active' : ''}`}
              onClick={() => setRange(null)}
            >
              Keep Current
            </button>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`range-btn ${range === r ? 'range-btn--active' : ''}`}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          {range !== null && (
            <p className="watchlist-sync-modal__warning">
              Changing range can trigger a fresh Twelve Data fetch for any card that hasn't
              loaded {range} before.
            </p>
          )}
        </div>

        <div className="watchlist-sync-modal__section">
          <span className="watchlist-sync-modal__label">Indicators</span>
          <div className="watchlist-card__ranges">
            {indicatorToggles.map(({ key, label, show, setShow }) => (
              <button
                key={key}
                type="button"
                className={`range-btn ${show ? 'range-btn--active' : ''}`}
                onClick={() => setShow((v) => !v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {showLevels && (
          <div className="watchlist-sync-modal__section">
            <span className="watchlist-sync-modal__label">Levels</span>
            <div className="watchlist-card__ranges">
              {LEVEL_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`range-btn ${levelCount === n ? 'range-btn--active' : ''}`}
                  onClick={() => setLevelCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="trade-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={handleApply}>
            Apply to All
          </button>
        </div>
      </div>
    </div>
  )
}
