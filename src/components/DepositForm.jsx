import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccounts } from '../hooks/useAccounts'
import './DepositForm.css'

const EMPTY_DEPOSIT = {
  account: '',
  amount: '',
  deposit_date: new Date().toISOString().slice(0, 10),
  notes: '',
}

export default function DepositForm({ deposit, onClose, onSaved }) {
  const { accounts, error: accountsError } = useAccounts()
  const [form, setForm] = useState(() => (deposit ? { ...deposit } : { ...EMPTY_DEPOSIT }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (deposit || !accounts.length) return
    setForm((prev) => (prev.account ? prev : { ...prev, account: accounts[0].name }))
  }, [accounts, deposit])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      account: form.account,
      amount: Number(form.amount),
      deposit_date: form.deposit_date,
      notes: form.notes,
    }

    const { error: saveError } = deposit?.id
      ? await supabase.from('deposits').update(payload).eq('id', deposit.id)
      : await supabase.from('deposits').insert(payload)

    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved?.()
    onClose?.()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">{deposit?.id ? 'Edit Deposit' : 'Add Deposit'}</h2>
        <form className="deposit-form" onSubmit={handleSubmit}>
          <div className="deposit-form__grid">
            <label>
              Account
              <select value={form.account} onChange={(e) => handleChange('account', e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
              {accountsError && <span className="deposit-form__error">Accounts failed to load: {accountsError}</span>}
            </label>
            <label>
              Amount
              <input
                type="number"
                step="any"
                required
                value={form.amount}
                onChange={(e) => handleChange('amount', e.target.value)}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={form.deposit_date}
                onChange={(e) => handleChange('deposit_date', e.target.value)}
              />
            </label>
            <label className="deposit-form__notes">
              Notes
              <textarea value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} />
            </label>
          </div>

          {error && <p className="deposit-form__error">{error}</p>}

          <div className="deposit-form__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Deposit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
