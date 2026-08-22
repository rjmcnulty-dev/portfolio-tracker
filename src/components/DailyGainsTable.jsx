import { useMemo, useState } from 'react'
import { useDailyGains } from '../hooks/useDailyGains'
import { useAccountValueBounds } from '../hooks/useAccountValueBounds'
import { useNetDepositsWithdrawals } from '../hooks/useNetDepositsWithdrawals'
import { useConfigValue } from '../hooks/useAppConfig'
import './DailyGainsTable.css'

const DEFAULT_DAILY_GAINS_DEFAULTS = { defaultDayCount: 5, weekSize: 5 }

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num) || value == null) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function pctClass(value) {
  if (value == null) return ''
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : ''
}

function formatDateHeader(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function DailyGainsTable({ account, holdings, trades }) {
  // null = default (5 most recent trading days); once the user touches
  // either date input this becomes an explicit { start, end }.
  const [customRange, setCustomRange] = useState(null)
  const { allDates, displayDates, rows, dailyTotals, loading, error } = useDailyGains(holdings, trades, customRange)
  const { weekSize: WEEK_SIZE } = useConfigValue('daily_gains_defaults', DEFAULT_DAILY_GAINS_DEFAULTS)

  const rangeStart = customRange?.start ?? displayDates[0] ?? ''
  const rangeEnd = customRange?.end ?? displayDates[displayDates.length - 1] ?? ''

  const { startValue, endValue } = useAccountValueBounds(account, rangeStart, rangeEnd)
  const valueChange = startValue != null && endValue != null ? endValue - startValue : null
  const valueChangePct = valueChange != null && startValue ? (valueChange / startValue) * 100 : null

  const { totalDeposits, totalWithdrawals, netAmount } = useNetDepositsWithdrawals(account, rangeStart, rangeEnd)

  // The account's total value change minus new capital in/out — i.e. what
  // Starting/Ending Account Value's Change would be if deposits/withdrawals
  // hadn't happened. Should track the Daily Gains table's own Total column
  // (grandTotalDollar below); the two aren't computed from the same data
  // (this one's account-value snapshots, that one's per-ticker price replay),
  // so treat close-but-not-exact as expected, not a bug.
  const netGainLoss = valueChange != null ? valueChange - netAmount : null
  const netGainLossPct = netGainLoss != null && startValue ? (netGainLoss / startValue) * 100 : null

  function handleStartChange(value) {
    setCustomRange({ start: value, end: rangeEnd })
  }

  function handleEndChange(value) {
    setCustomRange({ start: rangeStart, end: value })
  }

  // Partitions available trading days into 5-day chunks counting back from
  // the most recent, so "weeks" line up with trading activity rather than
  // calendar Mon-Sun boundaries — consistent with the default range itself
  // being "5 most recent trading days," not a calendar week.
  const weekOptions = useMemo(() => {
    const weeks = []
    const weekCount = Math.ceil(allDates.length / WEEK_SIZE)
    for (let i = 0; i < weekCount; i++) {
      const endIndex = allDates.length - i * WEEK_SIZE - 1
      const startIndex = Math.max(0, endIndex - (WEEK_SIZE - 1))
      weeks.push({
        label: i === 0 ? 'Last Week' : `${i + 1} weeks ago`,
        start: allDates[startIndex],
        end: allDates[endIndex],
      })
    }
    return weeks
  }, [allDates, WEEK_SIZE])

  const selectedWeekLabel = weekOptions.find((w) => w.start === rangeStart && w.end === rangeEnd)?.label ?? ''

  function handleWeekChange(label) {
    const week = weekOptions.find((w) => w.label === label)
    if (week) setCustomRange({ start: week.start, end: week.end })
  }

  const grandTotalDollar = dailyTotals.reduce((sum, d) => sum + (d.dollarChange ?? 0), 0)

  return (
    <div className="chart-card daily-gains">
      <h3 className="chart-card__title">Gains/Losses for Period</h3>

      <div className="daily-gains__value-summary">
        <div className="daily-gains__value-item">
          <span className="daily-gains__value-label">Deposits</span>
          <span className="daily-gains__value-amount is-positive">{formatCurrency(totalDeposits)}</span>
        </div>
        <div className="daily-gains__value-item">
          <span className="daily-gains__value-label">Withdrawals</span>
          <span className="daily-gains__value-amount is-negative">{formatCurrency(totalWithdrawals)}</span>
        </div>
        <div className="daily-gains__value-item">
          <span className="daily-gains__value-label">Net Deposits/Withdrawals</span>
          <span className={`daily-gains__value-amount ${pctClass(netAmount)}`}>{formatCurrency(netAmount)}</span>
        </div>
      </div>

      <div className="daily-gains__value-summary">
        <div className="daily-gains__value-item">
          <span className="daily-gains__value-label">Starting Account Value</span>
          <span className="daily-gains__value-amount">{formatCurrency(startValue)}</span>
        </div>
        <div className="daily-gains__value-item">
          <span className="daily-gains__value-label">Ending Account Value</span>
          <span className="daily-gains__value-amount">{formatCurrency(endValue)}</span>
        </div>
        {valueChange != null && (
          <div className="daily-gains__value-item">
            <span className="daily-gains__value-label">Change</span>
            <span className={`daily-gains__value-amount ${pctClass(valueChange)}`}>
              {formatCurrency(valueChange)} ({formatPct(valueChangePct)})
            </span>
          </div>
        )}
        {netGainLoss != null && (
          <div className="daily-gains__value-item">
            <span className="daily-gains__value-label">Net Gain/Loss</span>
            <span className={`daily-gains__value-amount ${pctClass(netGainLoss)}`}>
              {formatCurrency(netGainLoss)} ({formatPct(netGainLossPct)})
            </span>
          </div>
        )}
      </div>

      <div className="daily-gains__header">
        <div className="daily-gains__range-picker">
          <label>
            Week
            <select value={selectedWeekLabel} onChange={(e) => handleWeekChange(e.target.value)}>
              <option value="" disabled>
                Select…
              </option>
              {weekOptions.map((week) => (
                <option key={week.label} value={week.label}>
                  {week.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={rangeStart} max={rangeEnd || undefined} onChange={(e) => handleStartChange(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={rangeEnd} min={rangeStart || undefined} onChange={(e) => handleEndChange(e.target.value)} />
          </label>
          <button type="button" className="btn-link" onClick={() => setCustomRange(null)}>
            Last 5 Days
          </button>
        </div>
      </div>

      {error && <p className="chart-card__empty">Error: {error}</p>}
      {loading ? (
        <p className="chart-card__empty">Loading…</p>
      ) : !displayDates.length ? (
        <p className="chart-card__empty">
          No price history yet for this range — it's written once a day going forward, or run the one-time backfill
          script (see README) to fill in history from before this feature existed.
        </p>
      ) : !rows.length ? (
        <p className="chart-card__empty">No open positions.</p>
      ) : (
        <div className="daily-gains__table-wrap">
          <table className="daily-gains__table">
            <thead>
              <tr>
                <th>Ticker</th>
                {displayDates.map((date) => (
                  <th key={date} className="is-numeric">
                    {formatDateHeader(date)}
                  </th>
                ))}
                <th className="is-numeric">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticker}>
                  <td className="daily-gains__ticker">{row.ticker}</td>
                  {row.cells.map((cell, i) => (
                    <td
                      key={displayDates[i]}
                      className={`is-numeric ${pctClass(cell?.dollarChange)}`}
                      title={cell ? formatPct(cell.percentChange) : undefined}
                    >
                      {cell ? formatCurrency(cell.dollarChange) : '—'}
                    </td>
                  ))}
                  <td className={`is-numeric daily-gains__total-cell ${pctClass(row.totalDollar)}`} title={formatPct(row.totalPercent)}>
                    {formatCurrency(row.totalDollar)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="daily-gains__ticker">Total</td>
                {dailyTotals.map((day) => (
                  <td key={day.date} className={`is-numeric ${pctClass(day.dollarChange)}`} title={formatPct(day.percentChange)}>
                    {formatCurrency(day.dollarChange)}
                  </td>
                ))}
                <td className={`is-numeric daily-gains__total-cell ${pctClass(grandTotalDollar)}`}>
                  {formatCurrency(grandTotalDollar)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="daily-gains__hint">
        Hover a value for its % change. Cells show price-driven movement — a buy made that day is credited with its
        own gain/loss since purchase (against that day's price), not the day's move on shares it wasn't held for
        yet; deposits and sells aren't included, since neither is a price-driven gain. Net Gain/Loss above is Change
        with deposits and withdrawals backed out, so it should track this table's Total — small differences are
        expected, since Net Gain/Loss comes from daily account-value snapshots and the Total comes from a
        per-ticker price replay.
      </p>
    </div>
  )
}
