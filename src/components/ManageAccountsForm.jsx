import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import './TradeForm.css'
import './ManageAccountsForm.css'

export default function ManageAccountsForm({ accounts, onClose, onAdd, onDelete, onMove }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState(null)
  const [confirmingAccount, setConfirmingAccount] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [movingId, setMovingId] = useState(null)
  const [moveError, setMoveError] = useState(null)

  async function handleAdd(event) {
    event.preventDefault()
    setSaving(true)
    setAddError(null)

    try {
      await onAdd(name)
      setName('')
    } catch (err) {
      setAddError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleMove(account, direction) {
    setMovingId(account.id)
    setMoveError(null)
    try {
      await onMove(account.id, direction)
    } catch (err) {
      setMoveError(err.message)
    } finally {
      setMovingId(null)
    }
  }

  async function handleConfirmDelete() {
    const account = confirmingAccount
    setConfirmingAccount(null)
    setDeletingId(account.id)
    setDeleteError(null)

    try {
      await onDelete(account.id, account.name)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">Manage Accounts</h2>

        {accounts.length ? (
          <ul className="manage-accounts__list">
            {accounts.map((account, index) => (
              <li key={account.id} className="manage-accounts__item">
                <div className="manage-accounts__item-main">
                  <div className="manage-accounts__reorder">
                    <button
                      type="button"
                      className="manage-accounts__reorder-btn"
                      disabled={index === 0 || movingId === account.id}
                      onClick={() => handleMove(account, 'up')}
                      aria-label={`Move ${account.name} up`}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="manage-accounts__reorder-btn"
                      disabled={index === accounts.length - 1 || movingId === account.id}
                      onClick={() => handleMove(account, 'down')}
                      aria-label={`Move ${account.name} down`}
                    >
                      ▼
                    </button>
                  </div>
                  <span className="manage-accounts__name">{account.name}</span>
                </div>
                <button
                  type="button"
                  className="btn-link btn-link--danger"
                  disabled={deletingId === account.id}
                  onClick={() => setConfirmingAccount(account)}
                >
                  {deletingId === account.id ? 'Deleting…' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="manage-accounts__empty">No accounts yet.</p>
        )}
        {moveError && <p className="trade-form__error">{moveError}</p>}
        {deleteError && <p className="trade-form__error">{deleteError}</p>}

        <form className="trade-form" onSubmit={handleAdd}>
          <label>
            New Account Name
            <input
              autoFocus
              required
              placeholder="e.g. Fidelity 401(k)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {addError && <p className="trade-form__error">{addError}</p>}

          <div className="trade-form__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>

      {confirmingAccount && (
        <ConfirmDialog
          title="Delete account?"
          message={`Delete "${confirmingAccount.name}"? This only works if it has no trades, deposits, or schedules attached, and can't be undone.`}
          onCancel={() => setConfirmingAccount(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  )
}
