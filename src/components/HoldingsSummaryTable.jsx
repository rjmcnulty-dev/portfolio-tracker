import { useMemo, useState } from 'react'
import TickerLink from './TickerLink'
import './HoldingsSummaryTable.css'

const COLUMNS = [
  { key: 'ticker', label: 'Ticker' },
  { key: 'quantity', label: 'Qty', numeric: true },
  { key: 'avgCost', label: 'Avg Cost', numeric: true, currency: true },
  { key: 'currentPrice', label: 'Current Price', numeric: true, currency: true },
  { key: 'marketValue', label: 'Market Value', numeric: true, currency: true },
  { key: 'unrealizedPnl', label: 'Unrealized $', numeric: true, currency: true, pnl: true },
  { key: 'unrealizedPct', label: 'Unrealized %', numeric: true, percent: true, pnl: true },
]

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
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`
}

function pnlClass(value) {
  if (value > 0) return 'is-positive'
  if (value < 0) return 'is-negative'
  return ''
}

export default function HoldingsSummaryTable({ holdings }) {
  const [sortKey, setSortKey] = useState('marketValue')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    const rows = [...holdings]
    rows.sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (typeof aVal === 'number' || typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal))
    })
    return rows
  }, [holdings, sortKey, sortDir])

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  if (!holdings.length) {
    return <div className="holdings-summary__empty">No open positions yet.</div>
  }

  return (
    <div className="holdings-summary-wrap">
      <table className="holdings-summary">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} onClick={() => handleSort(col.key)} className={col.numeric ? 'is-numeric' : ''}>
                {col.label}
                {col.key === 'ticker' && <span className="column-hint">Click to view charts</span>}
                {sortKey === col.key && <span className="sort-arrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((holding) => (
            <tr key={holding.ticker}>
              <td>
                <TickerLink ticker={holding.ticker} className="holdings-summary__ticker" />
              </td>
              <td className="is-numeric">{formatQuantity(holding.quantity)}</td>
              <td className="is-numeric">{formatCurrency(holding.avgCost)}</td>
              <td className="is-numeric">{formatCurrency(holding.currentPrice)}</td>
              <td className="is-numeric">{formatCurrency(holding.marketValue)}</td>
              <td className={`is-numeric ${pnlClass(holding.unrealizedPnl)}`}>
                {formatCurrency(holding.unrealizedPnl)}
              </td>
              <td className={`is-numeric ${pnlClass(holding.unrealizedPct)}`}>
                {formatPercent(holding.unrealizedPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
