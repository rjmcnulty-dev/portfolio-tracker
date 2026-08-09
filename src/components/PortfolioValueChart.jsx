import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePortfolioValueHistory } from '../hooks/usePortfolioValueHistory'
import { useDeposits } from '../hooks/useDeposits'
import './PortfolioValueChart.css'

// "Daily"/"Monthly"/"Yearly" are lookback windows over the (always
// daily-granularity) history, not aggregation buckets — matches how Stock
// Watch's range buttons work. "All Time" has no lower bound.
const RANGES = [
  { key: 'daily', label: 'Daily', days: 30 },
  { key: 'monthly', label: 'Monthly', days: 365 },
  { key: 'yearly', label: 'Yearly', days: 1825 },
  { key: 'all', label: 'All Time', days: null },
]

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function formatDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatDateTick(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (days && days <= 30) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (days && days <= 365) return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// Renders nothing for a normal day; on a day with a deposit, draws a small
// marker plus its dollar amount directly on the line at that point.
function DepositDot({ cx, cy, payload }) {
  if (!payload.depositAmount) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill="var(--green)" stroke="#fff" strokeWidth={1.5} />
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--green)">
        {formatCurrency(payload.depositAmount)}
      </text>
    </g>
  )
}

// Custom content (rather than Tooltip's formatter) so a deposit day's
// callout can append the deposit amount alongside the value, the same
// "supplementary block in the hover callout" pattern as the Stock Watch
// support/resistance tooltip.
function ValueTooltip({ active, payload, label, title }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload

  return (
    <div className="portfolio-value-chart__tooltip">
      <p className="portfolio-value-chart__tooltip-label">{formatDate(label)}</p>
      <p className="portfolio-value-chart__tooltip-row">
        {title}: {formatCurrency(point.total_value)}
      </p>
      {point.depositAmount ? (
        <p className="portfolio-value-chart__tooltip-row portfolio-value-chart__tooltip-row--deposit">
          Deposit: {formatCurrency(point.depositAmount)}
        </p>
      ) : null}
    </div>
  )
}

export default function PortfolioValueChart({ account = 'All', title = 'Portfolio Value' }) {
  const { history, loading, error } = usePortfolioValueHistory(account)
  const { deposits } = useDeposits(account)
  const [rangeKey, setRangeKey] = useState('monthly')

  const range = RANGES.find((r) => r.key === rangeKey)

  // Multiple deposits landing on the same day are summed into one marker
  // rather than losing all but the last.
  const depositsByDate = useMemo(() => {
    const map = new Map()
    for (const deposit of deposits) {
      map.set(deposit.deposit_date, (map.get(deposit.deposit_date) || 0) + (Number(deposit.amount) || 0))
    }
    return map
  }, [deposits])

  const data = useMemo(() => {
    let inRange = history
    if (range.days) {
      const cutoff = new Date()
      cutoff.setUTCDate(cutoff.getUTCDate() - range.days)
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      inRange = history.filter((row) => row.snapshot_date >= cutoffStr)
    }
    return inRange.map((row) => ({ ...row, depositAmount: depositsByDate.get(row.snapshot_date) ?? null }))
  }, [history, range, depositsByDate])

  const latest = data.length ? data[data.length - 1].total_value : null
  const first = data.length ? data[0].total_value : null
  const change = latest != null && first != null ? latest - first : null
  const changePct = change != null && first ? (change / first) * 100 : null

  return (
    <div className="chart-card portfolio-value-chart">
      <div className="portfolio-value-chart__header">
        <div>
          <h3 className="chart-card__title">{title}</h3>
          {latest != null && (
            <span className="portfolio-value-chart__summary">
              {formatCurrency(latest)}
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
        <div className="portfolio-value-chart__ranges">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`portfolio-value-chart__range-btn ${rangeKey === r.key ? 'is-active' : ''}`}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="chart-card__empty">Error: {error}</p>}
      {loading ? (
        <p className="chart-card__empty">Loading portfolio value…</p>
      ) : !data.length ? (
        <p className="chart-card__empty">
          No portfolio value history yet for this range — it's written once a day going forward, or run the
          one-time backfill script (see README) to fill in history from before this chart existed.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ left: 8, right: 16 }}>
            <defs>
              <linearGradient id="portfolioValueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--blue)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--blue)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ee" />
            <XAxis
              dataKey="snapshot_date"
              tickFormatter={(v) => formatDateTick(v, range.days)}
              stroke="var(--text-muted)"
              fontSize={11}
              minTickGap={40}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickFormatter={formatCurrency}
              stroke="var(--text-muted)"
              fontSize={11}
              width={70}
            />
            <Tooltip content={<ValueTooltip title={title} />} />
            <Area
              type="monotone"
              dataKey="total_value"
              stroke="var(--blue)"
              fill="url(#portfolioValueFill)"
              strokeWidth={2}
              dot={<DepositDot />}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
