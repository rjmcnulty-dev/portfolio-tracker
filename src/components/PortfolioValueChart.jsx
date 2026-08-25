import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePortfolioValueHistory } from '../hooks/usePortfolioValueHistory'
import { useDeposits } from '../hooks/useDeposits'
import { useNetDepositsWithdrawals } from '../hooks/useNetDepositsWithdrawals'
import { getEffectiveStartDate } from '../lib/rangeFloor'
import RangeSelector from './RangeSelector'
import './PortfolioValueChart.css'

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

function pctClass(value) {
  if (value == null) return ''
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : ''
}

function formatDateTick(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (days && days <= 90) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (days && days <= 365) return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// Renders nothing for a normal day; on a day with a deposit or withdrawal,
// draws a small marker plus its dollar amount directly on the line at that
// point (a withdrawal is a negative depositAmount — see DepositForm.jsx).
function DepositDot({ cx, cy, payload }) {
  if (!payload.depositAmount) return null
  const color = payload.depositAmount >= 0 ? 'var(--green)' : 'var(--red)'
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize={10} fontWeight={600} fill={color}>
        {formatCurrency(Math.abs(payload.depositAmount))}
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
      <p className="portfolio-value-chart__tooltip-row">Deposits/Withdrawals to date: {formatCurrency(point.depositsBase)}</p>
      <p className="portfolio-value-chart__tooltip-row">Net Gain/Loss to date: {formatCurrency(point.netGain)}</p>
      {point.depositAmount ? (
        <p className="portfolio-value-chart__tooltip-row portfolio-value-chart__tooltip-row--deposit">
          {point.depositAmount >= 0 ? 'Deposit' : 'Withdrawal'}: {formatCurrency(Math.abs(point.depositAmount))}
        </p>
      ) : null}
    </div>
  )
}

export default function PortfolioValueChart({ account = 'All', title = 'Portfolio Value', dateRange }) {
  const { history, loading, error } = usePortfolioValueHistory(account)
  const { deposits } = useDeposits(account)

  const { startDate, endDate, days } = dateRange

  // Multiple deposits landing on the same day are summed into one marker
  // rather than losing all but the last.
  const depositsByDate = useMemo(() => {
    const map = new Map()
    for (const deposit of deposits) {
      map.set(deposit.deposit_date, (map.get(deposit.deposit_date) || 0) + (Number(deposit.amount) || 0))
    }
    return map
  }, [deposits])

  // Splits each day's total_value into a "capital" layer (net deposits and
  // withdrawals contributed by that date, all-time — not clipped to the
  // visible range, so even the Daily/Monthly views show the true baseline of
  // money put in) and a "net gain" layer stacked on top (whatever's left,
  // i.e. investment performance). depositsBase + netGain === total_value by
  // construction. Computed over the full history before range-filtering
  // below, via a merge over both series (both already date-ascending) rather
  // than a per-row scan, since history can be a few thousand rows.
  const historyWithLayers = useMemo(() => {
    const sortedDeposits = [...deposits].sort((a, b) => a.deposit_date.localeCompare(b.deposit_date))
    let depositIndex = 0
    let runningBase = 0
    return history.map((row) => {
      while (depositIndex < sortedDeposits.length && sortedDeposits[depositIndex].deposit_date <= row.snapshot_date) {
        runningBase += Number(sortedDeposits[depositIndex].amount) || 0
        depositIndex++
      }
      return { ...row, depositsBase: runningBase, netGain: Number(row.total_value) - runningBase }
    })
  }, [history, deposits])

  // The Change figure below is computed from the first row in range, so
  // that row can't be a near-zero pre-funding artifact (a stray test
  // balance before the real first deposit) — dividing by a near-zero
  // denominator would blow Change % up to a meaningless number. Clamped
  // forward to the first date with a "real" value; never earlier than what
  // was actually requested. See rangeFloor.js.
  const effectiveStartDate = useMemo(() => getEffectiveStartDate(history, startDate), [history, startDate])
  const startClamped = Boolean(effectiveStartDate && effectiveStartDate !== startDate)

  const data = useMemo(() => {
    const inRange = historyWithLayers.filter(
      (row) => (!effectiveStartDate || row.snapshot_date >= effectiveStartDate) && row.snapshot_date <= endDate,
    )
    return inRange.map((row) => ({ ...row, depositAmount: depositsByDate.get(row.snapshot_date) ?? null }))
  }, [historyWithLayers, effectiveStartDate, endDate, depositsByDate])

  // x-axis tick granularity keyed off the *actual* rendered date span, not
  // the preset's nominal day-count (dateRange.days) — see the identical
  // comment in BenchmarkComparisonChart.jsx for why the nominal figure can
  // overstate the real span once the inception floor clamps it shorter.
  const actualDays = useMemo(() => {
    if (data.length < 2) return days
    const first = new Date(`${data[0].snapshot_date}T00:00:00Z`)
    const last = new Date(`${data[data.length - 1].snapshot_date}T00:00:00Z`)
    return Math.round((last - first) / 86_400_000)
  }, [data, days])

  const latest = data.length ? data[data.length - 1].total_value : null
  const first = data.length ? data[0].total_value : null
  const change = latest != null && first != null ? latest - first : null
  const changePct = change != null && first ? (change / first) * 100 : null

  const rangeStart = data.length ? data[0].snapshot_date : ''
  const rangeEnd = data.length ? data[data.length - 1].snapshot_date : ''
  const { totalDeposits, totalWithdrawals, netAmount } = useNetDepositsWithdrawals(account, rangeStart, rangeEnd)

  // Change over the visible range with that range's own deposits/withdrawals
  // backed out — same idea as the Daily Gains card's Net Gain/Loss stat, but
  // here it's derived from `change`/`netAmount` above rather than a separate
  // hook, since both are already fetched for this range. Distinct from each
  // row's `netGain` field (all-time cumulative, used to draw the chart) —
  // this one is a single before/after figure for the selected range only.
  const rangeNetGain = change != null ? change - netAmount : null
  const rangeNetGainPct = rangeNetGain != null && first ? (rangeNetGain / first) * 100 : null

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
          {rangeNetGain != null && (
            <span className="portfolio-value-chart__net-gain">
              Net Gain/Loss{' '}
              <span className={rangeNetGain >= 0 ? 'is-positive' : 'is-negative'}>
                {rangeNetGain >= 0 ? '+' : ''}
                {formatCurrency(rangeNetGain)}
                {rangeNetGainPct != null ? ` (${rangeNetGainPct.toFixed(2)}%)` : ''}
              </span>
            </span>
          )}
          {startClamped && (
            <p className="portfolio-value-chart__caveat portfolio-value-chart__caveat--clamped">
              Chart starts {formatDate(effectiveStartDate)} — no meaningful account value before then.
            </p>
          )}
        </div>
        <RangeSelector dateRange={dateRange} />
      </div>

      <div className="portfolio-value-chart__value-summary">
        <div className="portfolio-value-chart__value-item">
          <span className="portfolio-value-chart__value-label">Deposits</span>
          <span className="portfolio-value-chart__value-amount is-positive">{formatCurrency(totalDeposits)}</span>
        </div>
        <div className="portfolio-value-chart__value-item">
          <span className="portfolio-value-chart__value-label">Withdrawals</span>
          <span className="portfolio-value-chart__value-amount is-negative">{formatCurrency(totalWithdrawals)}</span>
        </div>
        <div className="portfolio-value-chart__value-item">
          <span className="portfolio-value-chart__value-label">Net Deposits/Withdrawals</span>
          <span className={`portfolio-value-chart__value-amount ${pctClass(netAmount)}`}>{formatCurrency(netAmount)}</span>
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
        <>
          <div className="portfolio-value-chart__legend">
            <span className="portfolio-value-chart__legend-item">
              <span className="portfolio-value-chart__legend-swatch portfolio-value-chart__legend-swatch--deposits" />
              Deposits/Withdrawals
            </span>
            <span className="portfolio-value-chart__legend-item">
              <span className="portfolio-value-chart__legend-swatch portfolio-value-chart__legend-swatch--gain" />
              Net Gain/Loss
            </span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            {/* Stacked: depositsBase (capital contributed to date) fills first,
                netGain (investment performance) stacks on top of it, so the
                combined top edge is total_value. netGain can go negative when
                the account is underwater relative to contributions — Recharts
                still renders that correctly, dipping the top edge below the
                deposits line, but the fill (a flat color per series) doesn't
                switch to red for that segment; it's still readable via the
                Net Gain/Loss figure above and the tooltip. */}
            <AreaChart data={data} margin={{ left: 8, right: 16 }}>
              <defs>
                <linearGradient id="portfolioDepositsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--blue)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--blue)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="portfolioGainFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--green)" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="var(--green)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ee" />
              <XAxis
                dataKey="snapshot_date"
                tickFormatter={(v) => formatDateTick(v, actualDays)}
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
                dataKey="depositsBase"
                name="Deposits/Withdrawals"
                stackId="value"
                stroke="var(--blue)"
                fill="url(#portfolioDepositsFill)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="netGain"
                name="Net Gain/Loss"
                stackId="value"
                stroke="var(--green)"
                fill="url(#portfolioGainFill)"
                strokeWidth={2}
                dot={<DepositDot />}
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}
