import { useEffect, useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import './HoldingsTable.css'

// Kept in sync with every field in TradeForm's Add/Edit Trade modal (plus the
// derived "source" column) so the column picker can offer all of them.
const COLUMNS = [
  { key: 'trade_date', label: 'Date' },
  { key: 'account', label: 'Account' },
  { key: 'ticker', label: 'Ticker' },
  { key: 'trade_type', label: 'Type' },
  { key: 'quantity', label: 'Qty', numeric: true },
  { key: 'price', label: 'Price', numeric: true, currency: true, decimals: 3 },
  { key: 'fees', label: 'Fees', numeric: true, currency: true },
  { key: 'cost_basis', label: 'Cost Basis', numeric: true, currency: true },
  { key: 'market_price', label: 'Mkt Price', numeric: true, currency: true, decimals: 3 },
  { key: 'market_value', label: 'Mkt Value', numeric: true, currency: true },
  { key: 'realized_pnl', label: 'Realized', numeric: true, currency: true, pnl: true },
  { key: 'unrealized_pnl', label: 'Unrealized', numeric: true, currency: true, pnl: true },
  { key: 'wash_sale_risk', label: 'Wash Sale' },
  { key: 'source', label: 'Source' },
  { key: 'notes', label: 'Notes' },
]

const STORAGE_KEY = 'portfolio-tracker:holdings-table-columns'
const DEFAULT_VISIBLE_KEYS = COLUMNS.map((c) => c.key)

function loadVisibleKeys() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_VISIBLE_KEYS
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_KEYS
    // Drop any keys that no longer exist (e.g. a renamed column) rather than
    // trusting a stale saved list wholesale.
    const validKeys = new Set(COLUMNS.map((c) => c.key))
    return parsed.filter((key) => validKeys.has(key))
  } catch {
    return DEFAULT_VISIBLE_KEYS
  }
}

function formatCurrency(value, decimals = 2) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function washSaleClass(risk) {
  if (risk === 'FLAGGED') return 'wash-badge wash-badge--flagged'
  if (risk === 'Review') return 'wash-badge wash-badge--review'
  return 'wash-badge wash-badge--ok'
}

function sourceValue(trade) {
  return trade.schedule_id ? 'Recurring' : 'Manual'
}

// Account used to be force-hidden on single-account pages via a showAccount
// prop, excluding it from the picker entirely there. Now it's a normal
// column like any other — always offered, purely user-controlled — since
// showing your own account name on every row is harmless, and hiding it is
// just one checkbox away if you don't want it.
export default function HoldingsTable({ trades, onEdit, onDelete }) {
  const [sortKey, setSortKey] = useState('trade_date')
  const [sortDir, setSortDir] = useState('desc')
  const [confirmingTrade, setConfirmingTrade] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [visibleKeys, setVisibleKeys] = useState(loadVisibleKeys)
  const [showColumnPicker, setShowColumnPicker] = useState(false)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleKeys))
  }, [visibleKeys])

  const columns = COLUMNS.filter((col) => visibleKeys.includes(col.key))

  function toggleColumn(key) {
    setVisibleKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

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

  async function handleConfirmDelete() {
    const trade = confirmingTrade
    setConfirmingTrade(null)
    try {
      await onDelete(trade.id)
    } catch (err) {
      setDeleteError(err.message)
    }
  }

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div className="holdings-table-wrap">
      <div className="holdings-table__toolbar">
        <button className="btn btn--ghost" onClick={() => setShowColumnPicker(true)}>
          Columns
        </button>
      </div>

      {deleteError && <p className="trade-form__error">{deleteError}</p>}

      {!trades.length ? (
        <div className="holdings-table__empty">No trades recorded yet.</div>
      ) : (
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
                  const display = col.currency ? formatCurrency(raw, col.decimals) : raw ?? '—'
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
                      <button
                        className="btn-link btn-link--danger"
                        onClick={() => {
                          setDeleteError(null)
                          setConfirmingTrade(trade)
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmingTrade && (
        <ConfirmDialog
          title="Delete trade?"
          message={`Delete the ${confirmingTrade.ticker} trade from ${confirmingTrade.trade_date}? This can't be undone.`}
          onCancel={() => setConfirmingTrade(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {showColumnPicker && (
        <div
          className="modal-overlay"
          onClick={(event) => {
            event.stopPropagation()
            setShowColumnPicker(false)
          }}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">Customize Columns</h2>
            <ul className="column-picker__list">
              {COLUMNS.map((col) => (
                <li key={col.key} className="column-picker__item">
                  <label>
                    <input
                      type="checkbox"
                      checked={visibleKeys.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                </li>
              ))}
            </ul>
            <div className="column-picker__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setVisibleKeys(DEFAULT_VISIBLE_KEYS)}>
                Show All
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setShowColumnPicker(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
