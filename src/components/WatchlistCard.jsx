import { useMemo, useState } from 'react'
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
import './WatchlistCard.css'

const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y']

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

export default function WatchlistCard({ item, onRemove, onSaveNotes }) {
  const [range, setRange] = useState('1M')
  const [showSMA20, setShowSMA20] = useState(true)
  const [showSMA50, setShowSMA50] = useState(true)
  const [showLevels, setShowLevels] = useState(true)
  const [notes, setNotes] = useState(item.notes ?? '')
  const [notesDirty, setNotesDirty] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesError, setNotesError] = useState(null)

  const { series, nextEarningsDate, loading, error } = useStockQuote(item.ticker, range)

  const latestPrice = series.length ? series[series.length - 1].close : null
  const firstPrice = series.length ? series[0].close : null
  const change = latestPrice != null && firstPrice != null ? latestPrice - firstPrice : null
  const changePct = change != null && firstPrice ? (change / firstPrice) * 100 : null

  const sma20 = useMemo(() => computeSMA(series, 20), [series])
  const sma50 = useMemo(() => computeSMA(series, 50), [series])
  const { support, resistance } = useMemo(() => findSupportResistance(series), [series])

  const chartData = useMemo(
    () =>
      mergeIndicators(series, [
        { key: 'sma20', points: sma20 },
        { key: 'sma50', points: sma50 },
      ]),
    [series, sma20, sma50],
  )

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

  return (
    <div className="watchlist-card">
      <div className="watchlist-card__header">
        <div>
          <span className="watchlist-card__ticker">{item.ticker}</span>
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
        <button className="btn-link btn-link--danger" onClick={() => onRemove(item.id)}>
          Remove
        </button>
      </div>

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
        <button
          className={`range-btn ${showSMA20 ? 'range-btn--active' : ''}`}
          disabled={sma20.length === 0}
          onClick={() => setShowSMA20((v) => !v)}
        >
          MA 20
        </button>
        <button
          className={`range-btn ${showSMA50 ? 'range-btn--active' : ''}`}
          disabled={sma50.length === 0}
          onClick={() => setShowSMA50((v) => !v)}
        >
          MA 50
        </button>
        <button
          className={`range-btn ${showLevels ? 'range-btn--active' : ''}`}
          disabled={!support.length && !resistance.length}
          onClick={() => setShowLevels((v) => !v)}
        >
          Support / Resistance
        </button>
      </div>

      {error && <p className="watchlist-card__error">{error}</p>}
      {loading ? (
        <p className="watchlist-card__loading">Loading chart…</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
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
            <Tooltip
              formatter={(value, name) => [formatCurrency(value), name]}
              contentStyle={{ background: 'var(--navy-mid)', border: 'none', borderRadius: 8, color: '#fff' }}
            />
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
              <Line
                type="monotone"
                dataKey="sma20"
                name="MA 20"
                stroke="var(--gold)"
                dot={false}
                strokeWidth={1.5}
                connectNulls={false}
              />
            )}
            {showSMA50 && (
              <Line
                type="monotone"
                dataKey="sma50"
                name="MA 50"
                stroke="var(--navy-light)"
                dot={false}
                strokeWidth={1.5}
                connectNulls={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="watchlist-card__earnings">
        <span className="watchlist-card__earnings-label">Next Earnings</span>
        <span className="watchlist-card__earnings-value">{formatEarningsDate(nextEarningsDate)}</span>
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
    </div>
  )
}
