import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStockQuote } from '../hooks/useStockQuote'
import { computeSMA, findSupportResistance, mergeIndicators } from '../lib/technicalIndicators'
import ConfirmDialog from './ConfirmDialog'
import './WatchlistCard.css'

// 20D/50D/200D fetch enough history (2x the period — see watchlist-quote's
// RANGE_PARAMS) that the matching moving average (MA20/50/200) renders as a
// full line spanning the period it's named for, not just a single trailing
// point — "aligned" to that timeframe rather than cut off by too little
// data. Twelve Data returns daily bars for these same as 1M/3M/6M/1Y, so no
// special-casing is needed elsewhere (X-axis formatting, etc.).
export const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '20D', '50D', '200D']
export const LEVEL_COUNTS = [1, 2, 3, 4]

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatXAxisTick(value, range) {
  if (range === '1D') return value.split(' ')[1]?.slice(0, 5) ?? value
  if (range === '1W') return value.split(' ')[0]?.slice(5) ?? value
  return value.slice(5)
}

function formatEarningsDate(dateStr) {
  if (!dateStr) return 'Not available'
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Finnhub reports floatShares/sharesOutstanding in millions (e.g. 1126.1 ==
// ~1.13B shares). The percent is float's share of total shares outstanding
// — how much of the company is freely tradable vs. closely held (insiders,
// restricted stock, etc.), not a percent of some other "publicly held"
// total, since shares outstanding already represents 100% of the company.
function formatFloat(floatMillions, sharesOutstandingMillions) {
  if (floatMillions == null) return 'Not available'
  const shares = floatMillions * 1_000_000
  const formatted =
    shares >= 1_000_000_000
      ? `${(shares / 1_000_000_000).toFixed(2)}B shares`
      : shares >= 1_000_000
        ? `${(shares / 1_000_000).toFixed(1)}M shares`
        : `${shares.toLocaleString('en-US')} shares`

  if (!sharesOutstandingMillions) return formatted
  const pct = (floatMillions / sharesOutstandingMillions) * 100
  return `${formatted} (${pct.toFixed(1)}% of shares outstanding)`
}

function ChartControls({ range, setRange, indicators, levelCount, setLevelCount, showLevels }) {
  return (
    <>
      <div className="watchlist-card__ranges">
        {RANGES.map((r) => (
          <button
            key={r}
            className={`range-btn ${range === r ? 'range-btn--active' : ''}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="watchlist-card__ranges">
        {indicators.map(({ key, label, show, setShow, disabled }) => (
          <button
            key={key}
            className={`range-btn ${show ? 'range-btn--active' : ''}`}
            disabled={disabled}
            onClick={() => setShow((v) => !v)}
          >
            {label}
          </button>
        ))}
      </div>

      {showLevels && (
        <div className="watchlist-card__ranges">
          <span className="watchlist-card__levels-label">Levels</span>
          {LEVEL_COUNTS.map((n) => (
            <button
              key={n}
              className={`range-btn ${levelCount === n ? 'range-btn--active' : ''}`}
              onClick={() => setLevelCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// Support/resistance render as ReferenceLines, which Recharts' default
// Tooltip payload doesn't include (it only reflects Line/Area/Bar series at
// the hovered x). A custom content renderer lets the callout append them
// as a fixed supplementary block alongside whatever's under the cursor.
function ChartTooltip({ active, payload, label, support, resistance, showLevels }) {
  if (!active || !payload?.length) return null

  return (
    <div className="watchlist-card__tooltip">
      <p className="watchlist-card__tooltip-label">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="watchlist-card__tooltip-row" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
      {showLevels && (resistance.length > 0 || support.length > 0) && (
        <div className="watchlist-card__tooltip-levels">
          {resistance.map((level) => (
            <p key={`res-${level.price}`} className="watchlist-card__tooltip-row" style={{ color: 'var(--red)' }}>
              Resistance: {formatCurrency(level.price)}
            </p>
          ))}
          {support.map((level) => (
            <p key={`sup-${level.price}`} className="watchlist-card__tooltip-row" style={{ color: 'var(--green)' }}>
              Support: {formatCurrency(level.price)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function PriceChart({ chartData, range, showLevels, support, resistance, showSMA20, showSMA50, showSMA200, height }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ee" />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => formatXAxisTick(v, range)}
          stroke="var(--text-muted)"
          fontSize={11}
          minTickGap={30}
        />
        <YAxis domain={['auto', 'auto']} tickFormatter={formatCurrency} stroke="var(--text-muted)" fontSize={11} width={70} />
        <Tooltip content={<ChartTooltip support={support} resistance={resistance} showLevels={showLevels} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {showLevels &&
          resistance.map((level) => (
            <ReferenceLine
              key={`res-${level.price}`}
              y={level.price}
              stroke="var(--red)"
              strokeDasharray="4 4"
              label={{ value: `R ${formatCurrency(level.price)}`, position: 'insideTopRight', fill: 'var(--red)', fontSize: 10 }}
            />
          ))}
        {showLevels &&
          support.map((level) => (
            <ReferenceLine
              key={`sup-${level.price}`}
              y={level.price}
              stroke="var(--green)"
              strokeDasharray="4 4"
              label={{ value: `S ${formatCurrency(level.price)}`, position: 'insideBottomRight', fill: 'var(--green)', fontSize: 10 }}
            />
          ))}
        <Line type="monotone" dataKey="close" name="Close" stroke="var(--blue)" dot={false} strokeWidth={2} />
        {showSMA20 && (
          <Line type="monotone" dataKey="sma20" name="MA 20" stroke="var(--gold)" dot={false} strokeWidth={1.5} connectNulls={false} />
        )}
        {showSMA50 && (
          <Line
            type="monotone"
            dataKey="sma50"
            name="MA 50"
            stroke="var(--light-blue)"
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
        )}
        {showSMA200 && (
          <Line
            type="monotone"
            dataKey="sma200"
            name="MA 200"
            stroke="var(--purple)"
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function WatchlistCard({ item, onRemove, onSaveNotes, syncSettings }) {
  const [range, setRange] = useState('1M')
  const [showSMA20, setShowSMA20] = useState(true)
  const [showSMA50, setShowSMA50] = useState(true)
  const [showSMA200, setShowSMA200] = useState(true)
  const [showLevels, setShowLevels] = useState(true)
  const [levelCount, setLevelCount] = useState(2)
  const [expanded, setExpanded] = useState(false)

  // Cards otherwise manage these settings independently (so you can e.g.
  // view one ticker on 1Y and another on 1M at the same time) — the Sync
  // modal's "Apply to All" is a one-time broadcast, not a permanent link,
  // so this only overwrites local state when syncSettings.version changes,
  // never on every render.
  useEffect(() => {
    if (!syncSettings) return
    // null range means "leave this card's own range alone" — only the
    // indicator settings below are guaranteed free of any Twelve Data call.
    if (syncSettings.range != null) setRange(syncSettings.range)
    setShowSMA20(syncSettings.showSMA20)
    setShowSMA50(syncSettings.showSMA50)
    setShowSMA200(syncSettings.showSMA200)
    setShowLevels(syncSettings.showLevels)
    setLevelCount(syncSettings.levelCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSettings?.version])
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [notes, setNotes] = useState(item.notes ?? '')
  const [notesDirty, setNotesDirty] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesError, setNotesError] = useState(null)

  const { series, nextEarningsDate, companyName, floatShares, sharesOutstanding, loading, error, refresh } =
    useStockQuote(item.ticker, range)

  const latestPrice = series.length ? series[series.length - 1].close : null
  const firstPrice = series.length ? series[0].close : null
  const change = latestPrice != null && firstPrice != null ? latestPrice - firstPrice : null
  const changePct = change != null && firstPrice ? (change / firstPrice) * 100 : null

  const sma20 = useMemo(() => computeSMA(series, 20), [series])
  const sma50 = useMemo(() => computeSMA(series, 50), [series])
  const sma200 = useMemo(() => computeSMA(series, 200), [series])
  const { support, resistance } = useMemo(() => findSupportResistance(series, levelCount), [series, levelCount])

  const chartData = useMemo(
    () =>
      mergeIndicators(series, [
        { key: 'sma20', points: sma20 },
        { key: 'sma50', points: sma50 },
        { key: 'sma200', points: sma200 },
      ]),
    [series, sma20, sma50, sma200],
  )

  const indicatorToggles = [
    { key: 'sma20', label: 'MA 20', show: showSMA20, setShow: setShowSMA20, disabled: sma20.length === 0 },
    { key: 'sma50', label: 'MA 50', show: showSMA50, setShow: setShowSMA50, disabled: sma50.length === 0 },
    { key: 'sma200', label: 'MA 200', show: showSMA200, setShow: setShowSMA200, disabled: sma200.length === 0 },
    {
      key: 'levels',
      label: 'Support / Resistance',
      show: showLevels,
      setShow: setShowLevels,
      disabled: !support.length && !resistance.length,
    },
  ]

  async function handleSaveNotes() {
    setSavingNotes(true)
    setNotesError(null)
    try {
      await onSaveNotes(item.id, notes)
      setNotesDirty(false)
    } catch (err) {
      setNotesError(err.message)
    } finally {
      setSavingNotes(false)
    }
  }

  const chartProps = { chartData, range, showLevels, support, resistance, showSMA20, showSMA50, showSMA200 }

  return (
    <div className="watchlist-card">
      <div className="watchlist-card__header">
        <div>
          <div className="watchlist-card__title-row">
            <span className="watchlist-card__ticker">{item.ticker}</span>
            {companyName && <span className="watchlist-card__company">{companyName}</span>}
          </div>
          {latestPrice != null && (
            <span className="watchlist-card__price">
              {formatCurrency(latestPrice)}
              {change != null && (
                <span className={change >= 0 ? 'is-positive' : 'is-negative'}>
                  {' '}
                  {change >= 0 ? '+' : ''}
                  {formatCurrency(change)} ({changePct.toFixed(2)}%)
                </span>
              )}
            </span>
          )}
        </div>
        <div className="watchlist-card__header-actions">
          <button className="btn btn--ghost watchlist-card__refresh-btn" disabled={loading} onClick={refresh}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn-link" onClick={() => setExpanded(true)}>
            Expand
          </button>
          <button className="btn-link btn-link--danger" onClick={() => setConfirmingRemove(true)}>
            Remove
          </button>
        </div>
      </div>

      <ChartControls
        range={range}
        setRange={setRange}
        indicators={indicatorToggles}
        levelCount={levelCount}
        setLevelCount={setLevelCount}
        showLevels={showLevels}
      />

      {error && <p className="watchlist-card__error">{error}</p>}
      {loading ? <p className="watchlist-card__loading">Loading chart…</p> : <PriceChart {...chartProps} height={240} />}

      <div className="watchlist-card__earnings">
        <span className="watchlist-card__earnings-label">Next Earnings</span>
        <span className="watchlist-card__earnings-value">{formatEarningsDate(nextEarningsDate)}</span>
      </div>

      <div className="watchlist-card__earnings">
        <span className="watchlist-card__earnings-label">Float</span>
        <span className="watchlist-card__earnings-value">{formatFloat(floatShares, sharesOutstanding)}</span>
      </div>

      <div className="watchlist-card__notes">
        <label>
          Notes
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setNotesDirty(true)
            }}
          />
        </label>
        {notesError && <p className="watchlist-card__error">{notesError}</p>}
        <button className="btn btn--ghost" disabled={!notesDirty || savingNotes} onClick={handleSaveNotes}>
          {savingNotes ? 'Saving…' : 'Save Notes'}
        </button>
      </div>

      {expanded && (
        <div className="modal-overlay" onClick={() => setExpanded(false)}>
          <div className="modal watchlist-modal" onClick={(event) => event.stopPropagation()}>
            <div className="watchlist-modal__header">
              <div className="watchlist-card__title-row">
                <span className="watchlist-card__ticker">{item.ticker}</span>
                {companyName && <span className="watchlist-card__company">{companyName}</span>}
              </div>
              <div className="watchlist-card__header-actions">
                <button className="btn btn--ghost watchlist-card__refresh-btn" disabled={loading} onClick={refresh}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="btn-link" onClick={() => setExpanded(false)}>
                  Close
                </button>
              </div>
            </div>

            <ChartControls
        range={range}
        setRange={setRange}
        indicators={indicatorToggles}
        levelCount={levelCount}
        setLevelCount={setLevelCount}
        showLevels={showLevels}
      />

            {error && <p className="watchlist-card__error">{error}</p>}
            {loading ? <p className="watchlist-card__loading">Loading chart…</p> : <PriceChart {...chartProps} height={460} />}

            <div className="watchlist-card__earnings">
              <span className="watchlist-card__earnings-label">Next Earnings</span>
              <span className="watchlist-card__earnings-value">{formatEarningsDate(nextEarningsDate)}</span>
            </div>

            <div className="watchlist-card__earnings">
              <span className="watchlist-card__earnings-label">Float</span>
              <span className="watchlist-card__earnings-value">{formatFloat(floatShares, sharesOutstanding)}</span>
            </div>
          </div>
        </div>
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title="Remove from watchlist?"
          message={`Remove ${item.ticker} from Stock Watch? Your notes for it will be deleted too.`}
          confirmLabel="Remove"
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            setConfirmingRemove(false)
            onRemove(item.id)
          }}
        />
      )}
    </div>
  )
}
