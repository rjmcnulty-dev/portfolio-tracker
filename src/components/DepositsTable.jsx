import { useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import './DepositsTable.css'

const COLUMNS = [
  { key: 'deposit_date', label: 'Date' },
  { key: 'account', label: 'Account', accountOnly: true },
  { key: 'transaction_type', label: 'Deposit/Withdrawal' },
  { key: 'amount', label: 'Amount', numeric: true, currency: true, pnl: true },
  { key: 'deposit_type', label: 'Type' },
  { key: 'source', label: 'Source' },
  { key: 'notes', label: 'Notes' },
]

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function sourceValue(deposit) {
  return deposit.schedule_id ? 'Recurring' : 'Manual'
}

// A withdrawal is a deposits row with a negative amount (see
// DepositForm.jsx) rather than a separate table/column — derived here for
// display instead of stored, so it can never drift from the amount's sign.
function transactionTypeValue(deposit) {
  return Number(deposit.amount) < 0 ? 'Withdrawal' : 'Deposit'
}

export default function DepositsTable({ deposits, showAccount = true, onEdit, onDelete }) {
  const [sortKey, setSortKey] = useState('deposit_date')
  const [sortDir, setSortDir] = useState('desc')
  const [confirmingDeposit, setConfirmingDeposit] = useState(null)

  const columns = COLUMNS.filter((col) => !col.accountOnly || showAccount)

  const sorted = useMemo(() => {
    const rows = [...deposits]
    rows.sort((a, b) => {
      const aVal = sortKey === 'source' ? sourceValue(a) : sortKey === 'transaction_type' ? transactionTypeValue(a) : a[sortKey]
      const bVal = sortKey === 'source' ? sourceValue(b) : sortKey === 'transaction_type' ? transactionTypeValue(b) : b[sortKey]
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
  }, [deposits, sortKey, sortDir])

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (!deposits.length) {
    return <div className="deposits-table__empty">No deposits or withdrawals recorded yet.</div>
  }

  return (
    <div className="deposits-table-wrap">
      <table className="deposits-table">
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
          {sorted.map((deposit) => (
            <tr key={deposit.id}>
              {columns.map((col) => {
                if (col.key === 'account') {
                  return (
                    <td key={col.key}>
                      <span className="account-badge">{deposit.account}</span>
                    </td>
                  )
                }
                if (col.key === 'source') {
                  const isRecurring = Boolean(deposit.schedule_id)
                  return (
                    <td key={col.key}>
                      <span className={`source-badge ${isRecurring ? 'source-badge--recurring' : 'source-badge--manual'}`}>
                        {isRecurring ? 'Recurring' : 'Manual'}
                      </span>
                    </td>
                  )
                }
                if (col.key === 'transaction_type') {
                  const isWithdrawal = transactionTypeValue(deposit) === 'Withdrawal'
                  return (
                    <td key={col.key} className={isWithdrawal ? 'is-negative' : 'is-positive'}>
                      {isWithdrawal ? 'Withdrawal' : 'Deposit'}
                    </td>
                  )
                }
                const raw = deposit[col.key]
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
                    <button className="btn-link" onClick={() => onEdit(deposit)}>
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button className="btn-link btn-link--danger" onClick={() => setConfirmingDeposit(deposit)}>
                      Delete
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {confirmingDeposit && (
        <ConfirmDialog
          title="Delete transaction?"
          message={`Delete the ${formatCurrency(Math.abs(confirmingDeposit.amount))} ${transactionTypeValue(confirmingDeposit).toLowerCase()} from ${confirmingDeposit.deposit_date}? This can't be undone.`}
          onCancel={() => setConfirmingDeposit(null)}
          onConfirm={() => {
            onDelete(confirmingDeposit.id)
            setConfirmingDeposit(null)
          }}
        />
      )}
    </div>
  )
}
