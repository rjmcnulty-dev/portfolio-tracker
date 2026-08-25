import './RangeSelector.css'

// Shared by PortfolioValueChart and BenchmarkComparisonChart — pass the
// object returned from useDateRange(), called once by the page (AccountPage
// / Dashboard) so both charts stay on the same range. Preset buttons plus
// two date inputs for an exact custom range; touching either date input
// switches the selection to 'custom' automatically.
export default function RangeSelector({ dateRange }) {
  const { RANGES, rangeKey, customStart, customEnd, selectPreset, selectCustomStart, selectCustomEnd } = dateRange
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="range-selector">
      <div className="range-selector__presets">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`range-selector__btn ${rangeKey === r.key ? 'is-active' : ''}`}
            onClick={() => selectPreset(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="range-selector__custom">
        <input
          type="date"
          className="range-selector__date"
          value={customStart}
          max={customEnd || today}
          onChange={(e) => selectCustomStart(e.target.value)}
          aria-label="Custom range start date"
        />
        <span className="range-selector__to">to</span>
        <input
          type="date"
          className="range-selector__date"
          value={customEnd}
          min={customStart}
          max={today}
          onChange={(e) => selectCustomEnd(e.target.value)}
          aria-label="Custom range end date"
        />
      </div>
    </div>
  )
}
