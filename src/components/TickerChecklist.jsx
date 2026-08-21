import './TickerChecklist.css'

// Persistent left-side alternative to the old Filter popup — same
// hiddenTickers Set semantics (checked = visible), just always on screen
// instead of behind a button, so building a working subset of cards doesn't
// require opening/closing a modal for every change.
export default function TickerChecklist({ items, hiddenTickers, onToggle, onSelectAll, onDeselectAll }) {
  const visibleCount = items.length - hiddenTickers.size

  return (
    <aside className="ticker-checklist">
      <span className="ticker-checklist__title">Tickers</span>
      <div className="ticker-checklist__actions">
        <button type="button" className="btn-link" onClick={onSelectAll}>
          Select All
        </button>
        <button type="button" className="btn-link" onClick={onDeselectAll}>
          Deselect All
        </button>
      </div>
      <ul className="ticker-checklist__list">
        {items.map((item) => (
          <li key={item.id} className="ticker-checklist__item">
            <label>
              <input
                type="checkbox"
                checked={!hiddenTickers.has(item.ticker)}
                onChange={() => onToggle(item.ticker)}
              />
              <span>{item.ticker}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="ticker-checklist__summary">
        {visibleCount} of {items.length} shown
      </p>
    </aside>
  )
}
