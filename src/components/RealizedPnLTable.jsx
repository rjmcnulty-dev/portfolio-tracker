import { useMemo } from 'react'
import TickerLink from './TickerLink'
import './RealizedPnLTable.css'

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatQuantity(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function pnlClass(value) {
  if (value > 0) return 'is-positive'
  if (value < 0) return 'is-negative'
  return ''
}

// One row per SELL trade, not per ticker — the same ticker sold on
// different dates gets its own row each time, since when a gain/loss was
// realized (for tax purposes, or just tracking) is exactly what a
// per-ticker rollup would lose. `trade.realized_pnl` is already computed
// and stored at entry time from the specific lot(s) that sale closed (see
// "Realized P&L / lot matching" in the README) — this table doesn't
// recompute it, only derives proceeds/cost-basis for display from it.
export default function RealizedPnLTable({ trades }) {
  const rows = useMemo(() => {
    return trades
      .filter((t) => t.trade_type === 'SELL')
      .map((t) => {
        const quantity = Number(t.quantity) || 0
        const proceeds = quantity * (Number(t.price) || 0) - (Number(t.fees) || 0)
        const realizedPnl = Number(t.realized_pnl) || 0
        // Not trades.cost_basis — for a SELL row that column is auto-filled
        // with qty*price+fees (the same formula used for a BUY), which has
        // nothing to do with the cost basis of the lot(s) this sale closed.
        // Realized P&L is proceeds minus that lot cost basis, so it's
        // recoverable from the two numbers that ARE trustworthy here.
        const costBasis = proceeds - realizedPnl
        return {
          id: t.id,
          ticker: t.ticker,
          date: t.trade_date,
          quantity,
          proceeds,
          costBasis,
          realizedPnl,
          realizedPct: costBasis ? (realizedPnl / costBasis) * 100 : null,
        }
      })
      .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date))
  }, [trades])

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          proceeds: acc.proceeds + row.proceeds,
          costBasis: acc.costBasis + row.costBasis,
          realizedPnl: acc.realizedPnl + row.realizedPnl,
        }),
        { proceeds: 0, costBasis: 0, realizedPnl: 0 },
      ),
    [rows],
  )
  const totalPct = totals.costBasis ? (totals.realizedPnl / totals.costBasis) * 100 : null

  if (!rows.length) {
    return <div className="realized-pnl__empty">No sales yet.</div>
  }

  return (
    <div className="realized-pnl-wrap">
      <table className="realized-pnl">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Sell Date</th>
            <th className="is-numeric">Qty</th>
            <th className="is-numeric">Proceeds</th>
            <th className="is-numeric">Cost Basis</th>
            <th className="is-numeric">Realized $</th>
            <th className="is-numeric">Realized %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <TickerLink ticker={row.ticker} className="realized-pnl__ticker" />
              </td>
              <td>{formatDate(row.date)}</td>
              <td className="is-numeric">{formatQuantity(row.quantity)}</td>
              <td className="is-numeric">{formatCurrency(row.proceeds)}</td>
              <td className="is-numeric">{formatCurrency(row.costBasis)}</td>
              <td className={`is-numeric ${pnlClass(row.realizedPnl)}`}>{formatCurrency(row.realizedPnl)}</td>
              <td className={`is-numeric ${pnlClass(row.realizedPnl)}`}>{formatPercent(row.realizedPct)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="realized-pnl__total-label">Total</td>
            <td></td>
            <td></td>
            <td className="is-numeric">{formatCurrency(totals.proceeds)}</td>
            <td className="is-numeric">{formatCurrency(totals.costBasis)}</td>
            <td className={`is-numeric ${pnlClass(totals.realizedPnl)}`}>{formatCurrency(totals.realizedPnl)}</td>
            <td className={`is-numeric ${pnlClass(totals.realizedPnl)}`}>{formatPercent(totalPct)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
