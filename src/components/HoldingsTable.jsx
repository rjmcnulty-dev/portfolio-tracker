import { useMemo, useState } from 'react'
import './HoldingsTable.css'

const COLUMNS = [
  { key: 'trade_date', label: 'Date' },
  { key: 'account', label: 'Account', accountOnly: true },
  { key: 'ticker', label: 'Ticker' },
  { key: 'trade_type', label: 'Type' },
  { key: 'quantity', label: 'Qty', numeric: true },
  { key: 'price', label: 'Price', numeric: true, currency: true },
  { key: 'cost_basis', label: 'Cost Basis', numeric: true, currency: true },
  { key: 'market_price', label: 'Mkt Price', numeric: true, currency: true },
  { key: 'market_value', label: 'Mkt Value', numeric: true, currency: true },
  { key: 'realized_pnl', label: 'Realized', numeric: true, currency: true, pnl: true },
  { key: 'unrealized_pnl', label: 'Unrealized', numeric: true, currency: true, pnl: true },
  { key: 'wash_sale_risk', label: 'Wash Sale' },
  { key: 'source', label: 'Source' },
  { key: 'notes', label: 'Notes' },
]

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function washSaleClass(risk) {
  if (risk === 'FLAGGED') return 'wash-badge wash-badge--flagged'
  if (risk === 'Review') return 'wash-badge wash-badge--review'
  return 'wash-badge wash-badge--ok'
}

function sourceValue(trade) {
  return trade.schedule_id ? 'Recurring' : 'Manual'
}

export default function HoldingsTable({ trades, showAccount = true, onEdit, onDelete }) {
  const [sortKey, setSortKey] = useState('trade_date')
  const [sortDir, setSortDir] = useState('desc')

  const columns = COLUMNS.filter((col) => !col.accountOnly || showAccount)

  const sorted = useMemo(() => {
    const rows = [...trades]
    rows.sort((a, b) => {
      const aVal = sortKey === 'source' ? sourceValue(a) : a[sortKey]
      const bVal = sortKey === 'source' ? sourceValue(b) : b[sortKey]
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' || typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal))
    })
    return rows
  }, [trades, sortKey, sortDir])

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (!trades.length) {
    return <div className="holdings-table__empty">No trades recorded yet.</div>
  }

  return (
    <div className="holdings-table-wrap">
      <table className="holdings-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} onClick={() => handleSort(col.key)} className={col.numeric ? 'is-numeric' : ''}>
                {col.label}
                {sortKey === col.key && <span className="sort-arrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
            {(onEdit || onDelete) && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((trade) => (
            <tr key={trade.id}>
              {columns.map((col) => {
                if (col.key === 'wash_sale_risk') {
                  return (
                    <td key={col.key}>
                      <span className={washSaleClass(trade.wash_sale_risk)}>{trade.wash_sale_risk || 'OK'}</span>
                    </td>
                  )
                }
                if (col.key === 'account') {
                  return (
                    <td key={col.key}>
                      <span className="account-badge">{trade.account}</span>
                    </td>
                  )
                }
                if (col.key === 'source') {
                  const isRecurring = Boolean(trade.schedule_id)
                  return (
                    <td key={col.key}>
                      <span className={`source-badge ${isRecurring ? 'source-badge--recurring' : 'source-badge--manual'}`}>
                        {isRecurring ? 'Recurring' : 'Manual'}
                      </span>
                    </td>
                  )
                }
                const raw = trade[col.key]
                const display = col.currency ? formatCurrency(raw) : raw ?? '—'
                const cellClass = col.pnl ? (Number(raw) > 0 ? 'is-positive' : Number(raw) < 0 ? 'is-negative' : '') : ''
                return (
                  <td key={col.key} className={`${col.numeric ? 'is-numeric' : ''} ${cellClass}`}>
                    {display}
                  </td>
                )
              })}
              {(onEdit || onDelete) && (
                <td className="row-actions">
                  {onEdit && (
                    <button className="btn-link" onClick={() => onEdit(trade)}>
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button className="btn-link btn-link--danger" onClick={() => onDelete(trade.id)}>
                      Delete
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
