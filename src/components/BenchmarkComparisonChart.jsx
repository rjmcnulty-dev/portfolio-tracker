import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePortfolioValueHistory } from '../hooks/usePortfolioValueHistory'
import { useDeposits } from '../hooks/useDeposits'
import { useBenchmarks } from '../hooks/useBenchmarks'
import { useBenchmarkPriceHistory } from '../hooks/useBenchmarkPriceHistory'
import { getEffectiveStartDate } from '../lib/rangeFloor'
import RangeSelector from './RangeSelector'
import './BenchmarkComparisonChart.css'

const ACCOUNT_COLOR = 'var(--navy-dark)'
const TOGGLE_STORAGE_KEY = 'portfolio-tracker:benchmark-toggle'
const MODE_STORAGE_KEY = 'portfolio-tracker:benchmark-mode'

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
  if (days && days <= 90) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (days && days <= 365) return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatPct(value) {
  if (value == null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

// "Latest price on or before this date" over a ticker's full sorted
// history — mirrors backfill-portfolio-history.mjs's makePriceCursor,
// needed because account snapshots are daily (including weekends) while a
// benchmark's price history only has trading days.
function makePriceCursor(history) {
  let index = -1
  return function priceOnOrBefore(dateStr) {
    while (index + 1 < history.length && history[index + 1].as_of <= dateStr) {
      index += 1
    }
    return index >= 0 ? history[index].price : null
  }
}

function loadHiddenTickers() {
  try {
    const stored = window.localStorage.getItem(TOGGLE_STORAGE_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

function loadCumulativeMode() {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === 'cumulative'
  } catch {
    return false
  }
}

// A swatch dot carries each row's series color rather than the row's text
// itself — the Account line uses --navy-dark, which is nearly invisible as
// text color against this tooltip's own dark navy background. Text stays
// the tooltip's default white regardless of series color.
function ComparisonTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="benchmark-chart__tooltip">
      <p className="benchmark-chart__tooltip-label">{formatDate(label)}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="benchmark-chart__tooltip-row">
          <span className="benchmark-chart__tooltip-swatch" style={{ background: entry.color }} />
          {entry.name}: {formatPct(entry.value)}
        </p>
      ))}
    </div>
  )
}

export default function BenchmarkComparisonChart({ account = 'All', title = 'Portfolio vs. Benchmarks', dateRange }) {
  const { history, loading: historyLoading, error: historyError } = usePortfolioValueHistory(account)
  const { deposits } = useDeposits(account)
  const { benchmarks, loading: benchmarksLoading, error: benchmarksError } = useBenchmarks()
  const [hiddenTickers, setHiddenTickers] = useState(loadHiddenTickers)
  const [cumulativeMode, setCumulativeMode] = useState(loadCumulativeMode)

  const { startDate, endDate, days } = dateRange

  function toggleMode() {
    setCumulativeMode((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, next ? 'cumulative' : 'absolute')
      } catch {
        // Private browsing / storage disabled — the toggle still works for
        // this session, it just won't persist across reloads.
      }
      return next
    })
  }

  function toggleTicker(ticker) {
    setHiddenTickers((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      try {
        window.localStorage.setItem(TOGGLE_STORAGE_KEY, JSON.stringify([...next]))
      } catch {
        // Private browsing / storage disabled — the toggle still works for
        // this session, it just won't persist across reloads.
      }
      return next
    })
  }

  const visibleBenchmarks = useMemo(
    () => benchmarks.filter((b) => !hiddenTickers.has(b.ticker)),
    [benchmarks, hiddenTickers],
  )
  const visibleTickers = useMemo(() => visibleBenchmarks.map((b) => b.ticker), [visibleBenchmarks])

  // % change is computed from the first row in range, so that row can't be a
  // near-zero pre-funding artifact (a stray test balance before the real
  // first deposit) — that would blow the whole chart up to a meaningless
  // scale. Clamped forward to the first date with a "real" value; never
  // earlier than what was actually requested. See rangeFloor.js.
  const effectiveStartDate = useMemo(() => getEffectiveStartDate(history, startDate), [history, startDate])
  const startClamped = Boolean(effectiveStartDate && effectiveStartDate !== startDate)

  const rangeData = useMemo(() => {
    return history.filter((row) => (!effectiveStartDate || row.snapshot_date >= effectiveStartDate) && row.snapshot_date <= endDate)
  }, [history, effectiveStartDate, endDate])

  // The account's real inception date (floor-clamped, independent of
  // whatever range is currently selected) — the fixed baseline "Cumulative"
  // mode measures from, so switching ranges only changes which window of
  // that one continuous line is visible instead of resetting it to 0%.
  const inceptionDate = useMemo(() => getEffectiveStartDate(history, null), [history])
  const inceptionRow = useMemo(
    () => history.find((row) => !inceptionDate || row.snapshot_date >= inceptionDate) ?? null,
    [history, inceptionDate],
  )

  // Always anchored at inception (not just the visible range's start) so
  // Cumulative mode has price data back that far without needing to refetch
  // when the toggle flips — a few days earlier still, so the price cursor
  // can find a real "on or before" price even when inception lands on a
  // weekend/holiday with no trading-day price of its own.
  const priceHistoryFromDate = useMemo(() => {
    const anchor = inceptionDate ?? history[0]?.snapshot_date
    if (!anchor) return null
    const d = new Date(`${anchor}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 10)
    return d.toISOString().slice(0, 10)
  }, [inceptionDate, history])

  const { historyByTicker, loading: pricesLoading } = useBenchmarkPriceHistory(visibleTickers, priceHistoryFromDate, endDate)

  // Cumulative deposits/withdrawals as of each date, all-time (not clipped
  // to the visible range) — same construction as PortfolioValueChart's
  // historyWithLayers. Used below to isolate each individual day's own
  // deposit/withdrawal amount (today's total minus yesterday's).
  const depositsBaseByDate = useMemo(() => {
    const sorted = [...deposits].sort((a, b) => a.deposit_date.localeCompare(b.deposit_date))
    let index = 0
    let running = 0
    const map = new Map()
    for (const row of history) {
      while (index < sorted.length && sorted[index].deposit_date <= row.snapshot_date) {
        running += Number(sorted[index].amount) || 0
        index++
      }
      map.set(row.snapshot_date, running)
    }
    return map
  }, [history, deposits])

  // A chained/compounded index of the account's deposit-adjusted daily
  // returns — like a stock price, so the ratio between ANY two points on it
  // equals the real return over that exact sub-interval, not just the
  // overall range-to-date change. A simple "% from one fixed point" doesn't
  // have that property: only the interval anchored at that one fixed point
  // reads correctly, any sub-interval within it doesn't. Computed once
  // across the account's full history from inception forward; scale is
  // arbitrary (starts at 1) since every use below only ever reads a ratio
  // between two of its points, which cancels the starting value out.
  const accountIndexByDate = useMemo(() => {
    const map = new Map()
    const source = history.filter((row) => !inceptionDate || row.snapshot_date >= inceptionDate)
    let index = 1
    let prevValue = null
    let prevDepositsBase = 0
    for (const row of source) {
      const value = Number(row.total_value)
      const depositsBase = depositsBaseByDate.get(row.snapshot_date) ?? prevDepositsBase
      if (prevValue != null) {
        const depositsToday = depositsBase - prevDepositsBase
        const dailyReturn = prevValue > 0 ? (value - depositsToday - prevValue) / prevValue : 0
        index *= 1 + dailyReturn
      }
      map.set(row.snapshot_date, index)
      prevValue = value
      prevDepositsBase = depositsBase
    }
    return map
  }, [history, inceptionDate, depositsBaseByDate])

  // Absolute mode: baseline is the visible range's own first day (resets to
  // 0% whenever the range changes). Cumulative mode: baseline is always the
  // account's inception, so the line's values don't change when the range
  // does — picking a different range only changes which window of the same
  // continuous line is visible. Both benchmark and account lines share
  // whichever baseline is active, so the comparison stays apples-to-apples.
  const baselineRow = cumulativeMode ? inceptionRow : rangeData[0]

  const chartData = useMemo(() => {
    if (!rangeData.length || !baselineRow) return []

    const baselineIndex = accountIndexByDate.get(baselineRow.snapshot_date)
    const cursors = new Map(visibleBenchmarks.map((b) => [b.ticker, makePriceCursor(historyByTicker.get(b.ticker) ?? [])]))
    const baselinePrices = new Map(visibleBenchmarks.map((b) => [b.ticker, cursors.get(b.ticker)(baselineRow.snapshot_date)]))

    return rangeData.map((row) => {
      const rowIndex = accountIndexByDate.get(row.snapshot_date)
      const point = {
        date: row.snapshot_date,
        accountPct: baselineIndex && rowIndex != null ? (rowIndex / baselineIndex - 1) * 100 : null,
      }
      for (const b of visibleBenchmarks) {
        const price = cursors.get(b.ticker)(row.snapshot_date)
        const baselinePrice = baselinePrices.get(b.ticker)
        point[b.ticker] = price != null && baselinePrice ? ((price - baselinePrice) / baselinePrice) * 100 : null
      }
      return point
    })
  }, [rangeData, baselineRow, visibleBenchmarks, historyByTicker, accountIndexByDate])

  // x-axis tick granularity keyed off the *actual* rendered date span, not
  // the preset's nominal day-count (dateRange.days) — a "Monthly" (365-day)
  // preset can still render a much shorter span once clamped by the
  // inception floor or the account's real age, and formatting by the
  // nominal 365 would pick month+year granularity with no day number,
  // making every date in the same month render as an identical tick label.
  const actualDays = useMemo(() => {
    if (rangeData.length < 2) return days
    const first = new Date(`${rangeData[0].snapshot_date}T00:00:00Z`)
    const last = new Date(`${rangeData[rangeData.length - 1].snapshot_date}T00:00:00Z`)
    return Math.round((last - first) / 86_400_000)
  }, [rangeData, days])

  const loading = historyLoading || benchmarksLoading
  const error = historyError || benchmarksError

  return (
    <div className="chart-card benchmark-chart">
      <div className="benchmark-chart__header">
        <div>
          <h3 className="chart-card__title">{title}</h3>
          <p className="benchmark-chart__caveat">
            Account line compounds each day's deposit-adjusted return (like a stock price), so the rise between any
            two points reflects that period's real performance — comparable to the benchmarks' own price change.
          </p>
          {cumulativeMode ? (
            <p className="benchmark-chart__caveat benchmark-chart__caveat--clamped">
              Cumulative — measured since {formatDate(inceptionRow?.snapshot_date ?? inceptionDate)}. Changing the
              range only zooms the window; values don't reset.
            </p>
          ) : (
            <>
              <p className="benchmark-chart__caveat">Measured from the start of the selected range.</p>
              {startClamped && (
                <p className="benchmark-chart__caveat benchmark-chart__caveat--clamped">
                  Chart starts {formatDate(effectiveStartDate)} — no meaningful account value before then.
                </p>
              )}
            </>
          )}
        </div>
        <div className="benchmark-chart__controls">
          <div className="benchmark-chart__mode-toggle">
            <button
              type="button"
              className={`benchmark-chart__mode-btn ${!cumulativeMode ? 'is-active' : ''}`}
              onClick={() => cumulativeMode && toggleMode()}
            >
              Absolute
            </button>
            <button
              type="button"
              className={`benchmark-chart__mode-btn ${cumulativeMode ? 'is-active' : ''}`}
              onClick={() => !cumulativeMode && toggleMode()}
            >
              Cumulative
            </button>
          </div>
          <RangeSelector dateRange={dateRange} />
        </div>
      </div>

      {error && <p className="chart-card__empty">Error: {error}</p>}

      {!error && !loading && !benchmarks.length ? (
        <p className="chart-card__empty">
          No benchmarks yet — add one from /admin's Benchmarks tab to compare this account against a market index.
        </p>
      ) : (
        <>
          <div className="benchmark-chart__legend">
            <span className="benchmark-chart__legend-item benchmark-chart__legend-item--account">
              <span className="benchmark-chart__legend-swatch" style={{ background: ACCOUNT_COLOR }} />
              Account
            </span>
            {benchmarks.map((b) => {
              const isHidden = hiddenTickers.has(b.ticker)
              const hasHistory = !isHidden && (historyByTicker.get(b.ticker)?.length ?? 0) > 0
              return (
                <button
                  key={b.ticker}
                  type="button"
                  className={`benchmark-chart__legend-item benchmark-chart__legend-item--toggle ${isHidden ? 'is-hidden' : ''}`}
                  onClick={() => toggleTicker(b.ticker)}
                >
                  <span className="benchmark-chart__legend-swatch" style={{ background: b.color }} />
                  {b.name}
                  {!isHidden && !pricesLoading && !hasHistory && (
                    <span className="benchmark-chart__legend-hint">no history yet</span>
                  )}
                </button>
              )
            })}
          </div>

          {loading ? (
            <p className="chart-card__empty">Loading performance…</p>
          ) : !chartData.length ? (
            <p className="chart-card__empty">No portfolio value history yet for this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ee" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => formatDateTick(v, actualDays)}
                  stroke="var(--text-muted)"
                  fontSize={11}
                  minTickGap={40}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  stroke="var(--text-muted)"
                  fontSize={11}
                  width={56}
                />
                <ReferenceLine y={0} stroke="#d3d9e0" />
                <Tooltip content={<ComparisonTooltip />} />
                <Line
                  type="monotone"
                  dataKey="accountPct"
                  name="Account"
                  stroke={ACCOUNT_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                />
                {visibleBenchmarks.map((b) => (
                  <Line
                    key={b.ticker}
                    type="monotone"
                    dataKey={b.ticker}
                    name={b.name}
                    stroke={b.color}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  )
}
