import { useState } from 'react'
import { useTradeTypes } from '../hooks/useTradeTypes'
import ConfirmDialog from '../components/ConfirmDialog'
import './AdminTradeTypesPage.css'

// BUY/SELL/Scheduled Buy are permanently protected (no edit/delete control
// rendered at all, not just disabled) — the app's cost-basis/lot-matching/
// wash-sale logic assumes those exact strings exist. A custom type is
// always treated as a buy-lot type (adds shares, tracked cost basis) —
// there's no way to add a second SELL-like type, since closing a lot needs
// the wash-sale/lot-selection machinery SELL alone has. "Deducts cash"
// is what actually lets a type like Dividend Reinvestment be modeled
// correctly: shares added, cost basis tracked, but no matching cash
// outflow, since the money came from a dividend that was never recorded as
// cash either way.
export default function AdminTradeTypesPage() {
  const { tradeTypes, loading, error, addTradeType, updateTradeType, deleteTradeType } = useTradeTypes()
  const [newValue, setNewValue] = useState('')
  const [newDeductsCash, setNewDeductsCash] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)
  const [savingValue, setSavingValue] = useState(null)
  const [rowError, setRowError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

  async function handleAdd(event) {
    event.preventDefault()
    setAdding(true)
    setAddError(null)
    try {
      await addTradeType(newValue, newDeductsCash)
      setNewValue('')
      setNewDeductsCash(true)
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleToggleDeductsCash(type) {
    setSavingValue(type.value)
    setRowError(null)
    try {
      await updateTradeType(type.value, !type.deducts_cash)
    } catch (err) {
      setRowError(`${type.value}: ${err.message}`)
    } finally {
      setSavingValue(null)
    }
  }

  async function handleConfirmDelete() {
    const type = confirmingDelete
    setConfirmingDelete(null)
    setDeleteError(null)
    try {
      await deleteTradeType(type.value)
    } catch (err) {
      setDeleteError(err.message)
    }
  }

  if (loading) return <p className="page__loading">Loading trade types…</p>
  if (error) return <p className="page__error">Error: {error}</p>

  return (
    <div className="admin-trade-types">
      <table className="admin-trade-types__table">
        <thead>
          <tr>
            <th>Trade Type</th>
            <th>Deducts Cash</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tradeTypes.map((type) => (
            <tr key={type.value}>
              <td className="admin-trade-types__value">
                {type.value}
                {type.is_core && <span className="admin-trade-types__core-badge">Core</span>}
              </td>
              <td>
                {type.is_core ? (
                  type.deducts_cash ? 'Yes' : 'No'
                ) : (
                  <input
                    type="checkbox"
                    checked={type.deducts_cash}
                    disabled={savingValue === type.value}
                    onChange={() => handleToggleDeductsCash(type)}
                  />
                )}
              </td>
              <td className="admin-trade-types__actions">
                {!type.is_core && (
                  <button
                    type="button"
                    className="btn-link btn-link--danger"
                    onClick={() => setConfirmingDelete(type)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rowError && <p className="admin-trade-types__error">{rowError}</p>}
      {deleteError && <p className="admin-trade-types__error">{deleteError}</p>}

      <form className="admin-trade-types__add-form" onSubmit={handleAdd}>
        <label>
          New Trade Type
          <input
            required
            placeholder="e.g. Dividend Reinvestment"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
        </label>
        <label className="admin-trade-types__checkbox-label">
          <input type="checkbox" checked={newDeductsCash} onChange={(e) => setNewDeductsCash(e.target.checked)} />
          Deducts cash when recorded
        </label>
        {addError && <p className="admin-trade-types__error">{addError}</p>}
        <button type="submit" className="btn btn--primary" disabled={adding}>
          {adding ? 'Adding…' : '+ Add Trade Type'}
        </button>
      </form>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete trade type?"
          message={`Delete "${confirmingDelete.value}"? This only works if no trades currently use it, and can't be undone.`}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  )
}
