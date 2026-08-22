import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStockQuote } from '../hooks/useStockQuote'
import {
  computeEMA,
  computeOBV,
  computeSMA,
  computeStochastic,
  findSupportResistance,
  mergeIndicators,
  smoothPoints,
} from '../lib/technicalIndicators'
import { useConfigValue } from '../hooks/useAppConfig'
import { isBuyTrade } from '../lib/tradeTypes'
import ConfirmDialog from './ConfirmDialog'
import './WatchlistCard.css'

const DEFAULT_MA_PERIODS = [20, 50, 200]
const DEFAULT_SR_TUNING = { tolerancePct: 0.015, swingWindowPct: 0.03, maxLevelsDefault: 2, proximityPct: 0.03 }
const DEFAULT_STOCHASTIC_TUNING = { kPeriod: 14, kSmoothing: 3, dPeriod: 3, overbought: 80, oversold: 20 }
const DEFAULT_OBV_TUNING = { trendPeriod: 20, emaPeriod: 20 }

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

// OBV is a running sum of daily share volume, so it's routinely in the
// millions/billions — an axis of raw digits would be unreadable.
function formatVolume(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  const sign = num < 0 ? '-' : ''
  const abs = Math.abs(num)
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs}`
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

// dates is already most-recent-first (see watchlist-quote's
// recentEarningsDates) — independent of the selected chart range, unlike
// the on-chart markers, which only cover whatever's currently plotted.
function formatEarningsList(dates) {
  if (!dates.length) return 'None in the past year'
  return dates.map(formatEarningsDate).join('  ·  ')
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

// Support/resistance and earnings dates render as ReferenceLines, which
// Recharts' default Tooltip payload doesn't include (it only reflects
// Line/Area/Bar series at the hovered x). A custom content renderer lets the
// callout append them as a fixed supplementary block alongside whatever's
// under the cursor.
function ChartTooltip({
  active,
  payload,
  label,
  support,
  resistance,
  showLevels,
  showEarnings,
  earningsDates,
  showTrades,
  trades,
}) {
  if (!active || !payload?.length) return null

  const isEarningsDate = showEarnings && earningsDates.includes(label)
  const dayTrades = showTrades ? trades.filter((t) => t.chartDate === label) : []

  return (
    <div className="watchlist-card__tooltip">
      <p className="watchlist-card__tooltip-label">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="watchlist-card__tooltip-row" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
      {isEarningsDate && (
        <p className="watchlist-card__tooltip-row" style={{ color: 'var(--gold)' }}>
          Earnings report
        </p>
      )}
      {dayTrades.map((trade) => (
        <p
          key={trade.id}
          className="watchlist-card__tooltip-row"
          style={{ color: isBuyTrade(trade.trade_type) ? 'var(--green)' : 'var(--red)' }}
        >
          {trade.trade_type} {trade.quantity} @ {formatCurrency(trade.price)}
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

// A plain white-filled circle with a colored "$" glyph — plotted at each
// trade's own (date, execution price), not the day's close, so it sits
// exactly where the money actually changed hands even on a day the price
// moved around a lot after the trade. title gives a native browser tooltip
// on hover (Recharts' own Tooltip only reflects Line/Area/Bar series, not
// ReferenceDot).
function TradeMarker({ cx, cy, fill, title }) {
  if (cx == null || cy == null) return null
  return (
    <g>
      <title>{title}</title>
      <circle cx={cx} cy={cy} r={8} fill="#fff" stroke={fill} strokeWidth={1.5} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight="700" fill={fill}>
        $
      </text>
    </g>
  )
}

// Wrapped in memo — every prop here already comes from a stable useMemo
// upstream (chartData, support, resistance, earningsDates, visibleTrades),
// so this can safely skip re-rendering (and Recharts skip re-painting)
// whenever WatchlistCard re-renders for a reason unrelated to this chart's
// own data — typing in the Notes field, a page-level re-render cascading
// down from the ticking queue-status timer, etc.
const PriceChart = memo(function PriceChart({
  chartData,
  range,
  showLevels,
  support,
  resistance,
  showSMA20,
  showSMA50,
  showSMA200,
  maPeriods,
  showEarnings,
  earningsDates,
  showTrades,
  trades,
  height,
}) {
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
        <Tooltip
          content={
            <ChartTooltip
              support={support}
              resistance={resistance}
              showLevels={showLevels}
              showEarnings={showEarnings}
              earningsDates={earningsDates}
              showTrades={showTrades}
              trades={trades}
            />
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {showEarnings &&
          earningsDates.map((date) => (
            <ReferenceLine
              key={`earn-${date}`}
              x={date}
              stroke="var(--gold)"
              strokeDasharray="3 3"
              label={{ value: 'E', position: 'top', fill: 'var(--gold)', fontSize: 10 }}
            />
          ))}
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
        {showTrades &&
          trades.map((trade) => (
            <ReferenceDot
              key={trade.id}
              x={trade.chartDate}
              y={trade.price}
              shape={(props) => (
                <TradeMarker
                  {...props}
                  fill={isBuyTrade(trade.trade_type) ? 'var(--green)' : 'var(--red)'}
                  title={`${trade.trade_type} ${trade.quantity} @ ${formatCurrency(trade.price)} — ${trade.trade_date}`}
                />
              )}
            />
          ))}
        <Line type="monotone" dataKey="close" name="Close" stroke="var(--blue)" dot={false} strokeWidth={2} />
        {showSMA20 && (
          <Line type="monotone" dataKey="sma20" name={`MA ${maPeriods[0]}`} stroke="var(--gold)" dot={false} strokeWidth={1.5} connectNulls={false} />
        )}
        {showSMA50 && (
          <Line
            type="monotone"
            dataKey="sma50"
            name={`MA ${maPeriods[1]}`}
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
            name={`MA ${maPeriods[2]}`}
            stroke="var(--purple)"
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
})

function StochasticTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="watchlist-card__tooltip">
      <p className="watchlist-card__tooltip-label">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="watchlist-card__tooltip-row" style={{ color: entry.color }}>
          {entry.name}: {entry.value == null ? '—' : entry.value.toFixed(1)}
        </p>
      ))}
    </div>
  )
}

// Separate panel, not an overlay on PriceChart — %K/%D oscillate 0-100,
// incompatible with a dollar-price y-axis. Reads the same `chartData` array
// (stochK/stochD were merged into it alongside sma20/50/200), it just plots
// different fields on a different scale.
const StochasticChart = memo(function StochasticChart({ chartData, range, overbought, oversold, height }) {
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
        <YAxis domain={[0, 100]} ticks={[0, oversold, 50, overbought, 100]} stroke="var(--text-muted)" fontSize={11} width={70} />
        <Tooltip content={<StochasticTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine
          y={overbought}
          stroke="var(--text-muted)"
          strokeDasharray="4 4"
          label={{ value: 'Overbought', position: 'insideTopRight', fill: 'var(--text-muted)', fontSize: 10 }}
        />
        <ReferenceLine
          y={oversold}
          stroke="var(--text-muted)"
          strokeDasharray="4 4"
          label={{ value: 'Oversold', position: 'insideBottomRight', fill: 'var(--text-muted)', fontSize: 10 }}
        />
        <Line type="monotone" dataKey="stochK" name="%K" stroke="var(--blue)" dot={false} strokeWidth={1.5} connectNulls={false} />
        <Line type="monotone" dataKey="stochD" name="%D" stroke="var(--gold)" dot={false} strokeWidth={1.5} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
})

function ObvTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="watchlist-card__tooltip">
      <p className="watchlist-card__tooltip-label">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="watchlist-card__tooltip-row" style={{ color: entry.color }}>
          {entry.name}: {entry.value == null ? '—' : formatVolume(entry.value)}
        </p>
      ))}
    </div>
  )
}

// Separate panel, same reasoning as StochasticChart — OBV is a running sum
// of share volume (routinely in the millions/billions), incompatible with
// both the price chart's dollar axis and Stochastic's fixed 0-100 one, so it
// gets its own auto-scaled y-axis. Only the trend/slope is meaningful, never
// the absolute level, which is why there's no reference line here the way
// Stochastic has overbought/oversold thresholds — the trend line (a plain
// SMA of OBV, the standard "OBV signal line") and the EMA line (same idea,
// but reacts faster to recent changes since it weights them more heavily)
// are what actually show the underlying direction, since raw OBV is jumpy
// day to day.
const ObvChart = memo(function ObvChart({ chartData, range, trendPeriod, emaPeriod, height }) {
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
        <YAxis domain={['auto', 'auto']} tickFormatter={formatVolume} stroke="var(--text-muted)" fontSize={11} width={70} />
        <Tooltip content={<ObvTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="obv" name="OBV" stroke="var(--green)" dot={false} strokeWidth={1.5} connectNulls={false} />
        <Line
          type="monotone"
          dataKey="obvTrend"
          name={`Trend (${trendPeriod})`}
          stroke="var(--gold)"
          dot={false}
          strokeWidth={1.5}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="obvEma"
          name={`EMA (${emaPeriod})`}
          stroke="var(--light-blue)"
          dot={false}
          strokeWidth={1.5}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})

// change/changePct are already computed over the currently selected `range`
// (first vs. last close in that chart's series) — this just surfaces that
// same figure as a clearly labeled stat instead of an unlabeled aside next
// to the price.
function NetGainBadge({ change, changePct, range }) {
  if (change == null) return null
  return (
    <div className="watchlist-card__net-gain">
      <span className="watchlist-card__net-gain-label">Net Gain/Loss ({range})</span>
      <span className={`watchlist-card__net-gain-value ${change >= 0 ? 'is-positive' : 'is-negative'}`}>
        {change >= 0 ? '+' : ''}
        {formatCurrency(change)} ({changePct >= 0 ? '+' : ''}
        {changePct.toFixed(2)}%)
      </span>
    </div>
  )
}

function HeldBanner({ heldAccounts }) {
  if (!heldAccounts || heldAccounts.length === 0) return null
  return (
    <div className="watchlist-card__held-banner">
      <span>Held:</span>
      {heldAccounts.map((account) => (
        <span key={account} className="account-badge">
          {account}
        </span>
      ))}
    </div>
  )
}

function formatQuantity(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function pnlClass(value) {
  if (value > 0) return 'is-positive'
  if (value < 0) return 'is-negative'
  return ''
}

// Portfolio Stocks only (see WatchlistCard's accountHoldings prop) — Stock
// Watch never passes this, since a watched ticker isn't necessarily a real
// position. One row per account currently holding this ticker, even on a
// single-account tab (still useful to see that account's own quantity/P&L,
// not just the combined total already shown elsewhere on the card).
// Total (realized + unrealized) by default, with a toggle for unrealized-only
// — showUnrealizedOnly/onToggleUnrealized are lifted to WatchlistCard, same
// as every other chart control here, so the compact card and expanded modal
// (two separate mounts of this component) stay in sync with each other.
function AccountHoldingsBanner({ accountHoldings, showUnrealizedOnly, onToggleUnrealized }) {
  if (!accountHoldings || accountHoldings.length === 0) return null
  return (
    <div className="watchlist-card__account-holdings">
      <div className="watchlist-card__account-holdings-header">
        <span className="watchlist-card__account-holdings-label">P/L by Account</span>
        <div className="watchlist-card__account-holdings-toggle">
          <button
            type="button"
            className={`watchlist-card__account-holdings-toggle-btn ${!showUnrealizedOnly ? 'is-active' : ''}`}
            onClick={() => onToggleUnrealized(false)}
          >
            Total
          </button>
          <button
            type="button"
            className={`watchlist-card__account-holdings-toggle-btn ${showUnrealizedOnly ? 'is-active' : ''}`}
            onClick={() => onToggleUnrealized(true)}
          >
            Unrealized
          </button>
        </div>
      </div>
      {accountHoldings.map(({ account, quantity, unrealizedPnl, totalPnl }) => {
        const pnl = showUnrealizedOnly ? unrealizedPnl : totalPnl
        return (
          <div key={account} className="watchlist-card__account-holdings-row">
            <span className="account-badge">{account}</span>
            <span className="watchlist-card__account-holdings-qty">{formatQuantity(quantity)} sh</span>
            <span className={`watchlist-card__account-holdings-pnl ${pnlClass(pnl)}`}>{formatCurrency(pnl)}</span>
          </div>
        )
      })}
    </div>
  )
}

// modalOnly (used by TickerLink, e.g. a ticker cell on the Account pages'
// tables) skips the compact card entirely and renders straight into the
// expanded modal, already open — "Close" then calls the passed onClose
// (unmounts this instance) instead of collapsing back to a compact view
// that was never rendered.
function WatchlistCard({
  item,
  onRemove,
  onHide,
  onSaveNotes,
  syncSettings,
  subchartsBroadcast,
  heldAccounts,
  accountHoldings,
  trades,
  modalOnly,
  onClose,
}) {
  const maPeriods = useConfigValue('moving_average_periods', DEFAULT_MA_PERIODS)
  const srTuning = useConfigValue('support_resistance_tuning', DEFAULT_SR_TUNING)
  const stochasticTuning = useConfigValue('stochastic_tuning', DEFAULT_STOCHASTIC_TUNING)
  const obvTuning = useConfigValue('obv_tuning', DEFAULT_OBV_TUNING)
  // Falls back per-field, not just when the whole row is missing — an
  // obv_tuning row saved before emaPeriod existed won't have that key at
  // all, and useConfigValue only substitutes DEFAULT_OBV_TUNING when the
  // row itself is absent, not per-missing-field.
  const obvEmaPeriod = obvTuning.emaPeriod ?? DEFAULT_OBV_TUNING.emaPeriod
  const [range, setRange] = useState('1M')
  const [showSMA20, setShowSMA20] = useState(true)
  const [showSMA50, setShowSMA50] = useState(true)
  const [showSMA200, setShowSMA200] = useState(true)
  const [showLevels, setShowLevels] = useState(true)
  const [levelCount, setLevelCount] = useState(srTuning.maxLevelsDefault)
  const [showEarnings, setShowEarnings] = useState(true)
  const [showTrades, setShowTrades] = useState(true)
  const [showStochastic, setShowStochastic] = useState(true)
  const [showOBV, setShowOBV] = useState(true)
  const [expanded, setExpanded] = useState(Boolean(modalOnly))
  // config loads asynchronously, so `srTuning.maxLevelsDefault` is still the
  // hardcoded fallback at the moment the useState above reads it — this
  // re-applies the real default once app_config arrives, but only until the
  // user (or the Sync modal, below) has actually set a level count.
  const levelCountTouched = useRef(false)

  useEffect(() => {
    if (!levelCountTouched.current) setLevelCount(srTuning.maxLevelsDefault)
  }, [srTuning.maxLevelsDefault])

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
    levelCountTouched.current = true
    setLevelCount(syncSettings.levelCount)
    setShowEarnings(syncSettings.showEarnings)
    setShowTrades(syncSettings.showTrades)
    setShowStochastic(syncSettings.showStochastic)
    setShowOBV(syncSettings.showOBV)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSettings?.version])

  // A lighter-weight broadcast than the full Sync modal above — the page's
  // "Hide/Show All Subcharts" button just flips every subchart's visibility
  // together, leaving range/MA/levels/earnings alone. Add any future
  // subchart's setter here too.
  useEffect(() => {
    if (!subchartsBroadcast) return
    setShowStochastic(subchartsBroadcast.visible)
    setShowOBV(subchartsBroadcast.visible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subchartsBroadcast?.version])
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [showUnrealizedOnly, setShowUnrealizedOnly] = useState(false)
  const [notes, setNotes] = useState(item.notes ?? '')
  const [notesDirty, setNotesDirty] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesError, setNotesError] = useState(null)

  const {
    series,
    nextEarningsDate,
    earningsDates,
    recentEarningsDates,
    companyName,
    floatShares,
    sharesOutstanding,
    loading,
    error,
    refresh,
  } = useStockQuote(item.ticker, range)

  const latestPrice = series.length ? series[series.length - 1].close : null
  const firstPrice = series.length ? series[0].close : null
  const change = latestPrice != null && firstPrice != null ? latestPrice - firstPrice : null
  const changePct = change != null && firstPrice ? (change / firstPrice) * 100 : null

  const sma20 = useMemo(() => computeSMA(series, maPeriods[0]), [series, maPeriods])
  const sma50 = useMemo(() => computeSMA(series, maPeriods[1]), [series, maPeriods])
  const sma200 = useMemo(() => computeSMA(series, maPeriods[2]), [series, maPeriods])
  const { support, resistance } = useMemo(
    () => findSupportResistance(series, levelCount, srTuning.tolerancePct, srTuning.swingWindowPct),
    [series, levelCount, srTuning],
  )
  const stochastic = useMemo(
    () => computeStochastic(series, stochasticTuning.kPeriod, stochasticTuning.kSmoothing, stochasticTuning.dPeriod),
    [series, stochasticTuning],
  )
  const obv = useMemo(() => computeOBV(series), [series])
  const obvTrend = useMemo(() => smoothPoints(obv, obvTuning.trendPeriod), [obv, obvTuning])
  const obvEma = useMemo(() => computeEMA(obv, obvEmaPeriod), [obv, obvEmaPeriod])

  const chartData = useMemo(
    () =>
      mergeIndicators(series, [
        { key: 'sma20', points: sma20 },
        { key: 'sma50', points: sma50 },
        { key: 'sma200', points: sma200 },
        { key: 'stochK', points: stochastic.k },
        { key: 'stochD', points: stochastic.d },
        { key: 'obv', points: obv },
        { key: 'obvTrend', points: obvTrend },
        { key: 'obvEma', points: obvEma },
      ]),
    [series, sma20, sma50, sma200, stochastic, obv, obvTrend, obvEma],
  )

  // Matches each trade to the chartData point for its day — chartData's own
  // `date` values carry a time-of-day for intraday ranges (1D/1W), so an
  // exact string match only works for daily-or-coarser ranges; startsWith
  // covers both. A trade with no matching point (outside the currently
  // selected range, or a day with no price data) is silently dropped rather
  // than plotted with no real x position.
  const visibleTrades = useMemo(() => {
    if (!trades?.length) return []
    return trades
      .map((trade) => {
        const point = chartData.find((d) => d.date === trade.trade_date || d.date.startsWith(trade.trade_date))
        if (!point) return null
        return { ...trade, chartDate: point.date, price: Number(trade.price) }
      })
      .filter(Boolean)
  }, [trades, chartData])

  function closeExpanded() {
    if (modalOnly) onClose?.()
    else setExpanded(false)
  }

  function handleLevelCountChange(n) {
    levelCountTouched.current = true
    setLevelCount(n)
  }

  const indicatorToggles = [
    { key: 'sma20', label: `MA ${maPeriods[0]}`, show: showSMA20, setShow: setShowSMA20, disabled: sma20.length === 0 },
    { key: 'sma50', label: `MA ${maPeriods[1]}`, show: showSMA50, setShow: setShowSMA50, disabled: sma50.length === 0 },
    { key: 'sma200', label: `MA ${maPeriods[2]}`, show: showSMA200, setShow: setShowSMA200, disabled: sma200.length === 0 },
    {
      key: 'levels',
      label: 'Support / Resistance',
      show: showLevels,
      setShow: setShowLevels,
      disabled: !support.length && !resistance.length,
    },
    {
      key: 'earnings',
      label: 'Earnings',
      show: showEarnings,
      setShow: setShowEarnings,
      disabled: !earningsDates.length,
    },
    {
      key: 'trades',
      label: 'Trades',
      show: showTrades,
      setShow: setShowTrades,
      disabled: !visibleTrades.length,
    },
    {
      key: 'stochastic',
      label: 'Stochastic',
      show: showStochastic,
      setShow: setShowStochastic,
      disabled: !stochastic.k.length,
    },
    {
      key: 'obv',
      label: 'OBV',
      show: showOBV,
      setShow: setShowOBV,
      disabled: !obv.length,
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

  const chartProps = {
    chartData,
    range,
    showLevels,
    support,
    resistance,
    showSMA20,
    showSMA50,
    showSMA200,
    maPeriods,
    showEarnings,
    earningsDates,
    showTrades,
    trades: visibleTrades,
  }

  return (
    <>
      {!modalOnly && (
        <div className="watchlist-card">
          <HeldBanner heldAccounts={heldAccounts} />
          <AccountHoldingsBanner
            accountHoldings={accountHoldings}
            showUnrealizedOnly={showUnrealizedOnly}
            onToggleUnrealized={setShowUnrealizedOnly}
          />
          <div className="watchlist-card__header">
            <div>
              <div className="watchlist-card__title-row">
                <span className="watchlist-card__ticker">{item.ticker}</span>
                {companyName && <span className="watchlist-card__company">{companyName}</span>}
              </div>
              {latestPrice != null && <span className="watchlist-card__price">{formatCurrency(latestPrice)}</span>}
            </div>
            <div className="watchlist-card__header-right">
              <NetGainBadge change={change} changePct={changePct} range={range} />
              <div className="watchlist-card__header-actions">
                <button className="btn btn--ghost watchlist-card__refresh-btn" disabled={loading} onClick={refresh}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="btn-link" onClick={() => setExpanded(true)}>
                  Expand
                </button>
                <button className="btn-link" onClick={() => onHide(item.ticker)}>
                  Hide
                </button>
                {onRemove && (
                  <button className="btn-link btn-link--danger" onClick={() => setConfirmingRemove(true)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <ChartControls
            range={range}
            setRange={setRange}
            indicators={indicatorToggles}
            levelCount={levelCount}
            setLevelCount={handleLevelCountChange}
            showLevels={showLevels}
          />

          {error && <p className="watchlist-card__error">{error}</p>}
          {loading ? (
            <p className="watchlist-card__loading">Loading chart…</p>
          ) : (
            <>
              <PriceChart {...chartProps} height={240} />
              {showStochastic && stochastic.k.length > 0 && (
                <>
                  <span className="watchlist-card__stochastic-label">
                    Stochastic ({stochasticTuning.kPeriod}, {stochasticTuning.kSmoothing}, {stochasticTuning.dPeriod})
                  </span>
                  <StochasticChart
                    chartData={chartData}
                    range={range}
                    overbought={stochasticTuning.overbought}
                    oversold={stochasticTuning.oversold}
                    height={100}
                  />
                </>
              )}
              {showOBV && obv.length > 0 && (
                <>
                  <span className="watchlist-card__stochastic-label">
                    On Balance Volume (Trend: {obvTuning.trendPeriod}, EMA: {obvEmaPeriod})
                  </span>
                  <ObvChart
                    chartData={chartData}
                    range={range}
                    trendPeriod={obvTuning.trendPeriod}
                    emaPeriod={obvEmaPeriod}
                    height={100}
                  />
                </>
              )}
            </>
          )}

          <div className="watchlist-card__earnings">
            <span className="watchlist-card__earnings-label">Next Earnings</span>
            <span className="watchlist-card__earnings-value">{formatEarningsDate(nextEarningsDate)}</span>
          </div>

          <div className="watchlist-card__earnings">
            <span className="watchlist-card__earnings-label">Recent Earnings</span>
            <span className="watchlist-card__earnings-value watchlist-card__earnings-value--list">
              {formatEarningsList(recentEarningsDates)}
            </span>
          </div>

          <div className="watchlist-card__earnings">
            <span className="watchlist-card__earnings-label">Float</span>
            <span className="watchlist-card__earnings-value">{formatFloat(floatShares, sharesOutstanding)}</span>
          </div>

          {onSaveNotes && (
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
          )}
        </div>
      )}

      {expanded && (
        <div className="modal-overlay" onClick={closeExpanded}>
          <div className="modal watchlist-modal" onClick={(event) => event.stopPropagation()}>
            <HeldBanner heldAccounts={heldAccounts} />
            <AccountHoldingsBanner
              accountHoldings={accountHoldings}
              showUnrealizedOnly={showUnrealizedOnly}
              onToggleUnrealized={setShowUnrealizedOnly}
            />
            <div className="watchlist-modal__header">
              <div className="watchlist-card__title-row">
                <span className="watchlist-card__ticker">{item.ticker}</span>
                {companyName && <span className="watchlist-card__company">{companyName}</span>}
              </div>
              <div className="watchlist-card__header-right">
                <NetGainBadge change={change} changePct={changePct} range={range} />
                <div className="watchlist-card__header-actions">
                  <button className="btn btn--ghost watchlist-card__refresh-btn" disabled={loading} onClick={refresh}>
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button className="btn-link" onClick={closeExpanded}>
                    Close
                  </button>
                </div>
              </div>
            </div>

            <ChartControls
        range={range}
        setRange={setRange}
        indicators={indicatorToggles}
        levelCount={levelCount}
        setLevelCount={handleLevelCountChange}
        showLevels={showLevels}
      />

            {error && <p className="watchlist-card__error">{error}</p>}
            {loading ? (
              <p className="watchlist-card__loading">Loading chart…</p>
            ) : (
              <>
                <PriceChart {...chartProps} height={460} />
                {showStochastic && stochastic.k.length > 0 && (
                  <>
                    <span className="watchlist-card__stochastic-label">
                      Stochastic ({stochasticTuning.kPeriod}, {stochasticTuning.kSmoothing}, {stochasticTuning.dPeriod})
                    </span>
                    <StochasticChart
                      chartData={chartData}
                      range={range}
                      overbought={stochasticTuning.overbought}
                      oversold={stochasticTuning.oversold}
                      height={160}
                    />
                  </>
                )}
                {showOBV && obv.length > 0 && (
                  <>
                    <span className="watchlist-card__stochastic-label">
                      On Balance Volume (Trend: {obvTuning.trendPeriod}, EMA: {obvEmaPeriod})
                    </span>
                    <ObvChart
                      chartData={chartData}
                      range={range}
                      trendPeriod={obvTuning.trendPeriod}
                      emaPeriod={obvEmaPeriod}
                      height={160}
                    />
                  </>
                )}
              </>
            )}

            <div className="watchlist-card__earnings">
              <span className="watchlist-card__earnings-label">Next Earnings</span>
              <span className="watchlist-card__earnings-value">{formatEarningsDate(nextEarningsDate)}</span>
            </div>

            <div className="watchlist-card__earnings">
              <span className="watchlist-card__earnings-label">Recent Earnings</span>
              <span className="watchlist-card__earnings-value watchlist-card__earnings-value--list">{formatEarningsList(recentEarningsDates)}</span>
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
    </>
  )
}

// See PriceChart's comment — the same reasoning applies one level up: every
// prop passed in from StockWatchPage/PortfolioStocksPage is now a stable
// reference (item/watchlist/items via useMemo, handlers via useCallback,
// Map.get() lookups against useMemo'd Maps), so this can safely skip
// re-rendering this card — and everything inside it, including its three
// Recharts trees — when a sibling card's data changes or the page
// re-renders for an unrelated reason (e.g. the queue-status ticker).
export default memo(WatchlistCard)
