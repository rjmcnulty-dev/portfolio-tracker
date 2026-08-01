import { useState } from 'react'
import './TradeForm.css'

export default function AddAccountForm({ onClose, onAdd }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      await onAdd(name)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">Add Account</h2>
        <form className="trade-form" onSubmit={handleSubmit}>
          <label>
            Account Name
            <input
              autoFocus
              required
              placeholder="e.g. Fidelity 401(k)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {error && <p className="trade-form__error">{error}</p>}

          <div className="trade-form__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
