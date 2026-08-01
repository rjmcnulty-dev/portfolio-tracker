import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import './TradeForm.css'
import './ManageAccountsForm.css'

export default function ManageAccountsForm({ accounts, onClose, onAdd, onDelete }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState(null)
  const [confirmingAccount, setConfirmingAccount] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

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
            {accounts.map((account) => (
              <li key={account.id} className="manage-accounts__item">
                <span>{account.name}</span>
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
