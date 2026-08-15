import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccounts } from '../hooks/useAccounts'
import { useConfigValue } from '../hooks/useAppConfig'
import './DepositForm.css'

const DEFAULT_DEPOSIT_TYPES = ['Cash Deposit', 'Rollover', 'Short Term Capital Gain', 'Long Term Capital Gain', 'Dividend']

const EMPTY_DEPOSIT = {
  account: '',
  transaction_type: 'Deposit',
  amount: '',
  deposit_date: new Date().toISOString().slice(0, 10),
  deposit_type: DEFAULT_DEPOSIT_TYPES[0],
  notes: '',
}

// A withdrawal is stored as a negative `amount` on the same `deposits` row
// — every cash-position formula in the app (usePortfolio's cashPosition,
// the daily price-refresh job, the portfolio-value backfill script) already
// does a plain sum over `amount`, so a negative value nets out correctly
// everywhere with no separate table or extra logic needed. The form itself
// still takes a plain positive number from the user and applies the sign
// based on the Deposit/Withdrawal choice, rather than making them type "-500".
function toFormState(deposit) {
  const amount = Number(deposit.amount) || 0
  return { ...deposit, transaction_type: amount < 0 ? 'Withdrawal' : 'Deposit', amount: Math.abs(amount) }
}

export default function DepositForm({ deposit, onClose, onSaved }) {
  const { accounts, error: accountsError } = useAccounts()
  const DEPOSIT_TYPES = useConfigValue('deposit_types', DEFAULT_DEPOSIT_TYPES)
  const [form, setForm] = useState(() => (deposit ? toFormState(deposit) : { ...EMPTY_DEPOSIT }))
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

    const signedAmount = form.transaction_type === 'Withdrawal' ? -Math.abs(Number(form.amount)) : Math.abs(Number(form.amount))

    const payload = {
      account: form.account,
      amount: signedAmount,
      deposit_date: form.deposit_date,
      deposit_type: form.deposit_type,
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
        <h2 className="modal__title">{deposit?.id ? 'Edit Transaction' : 'Add Transaction'}</h2>
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
              Transaction Type
              <select value={form.transaction_type} onChange={(e) => handleChange('transaction_type', e.target.value)}>
                <option value="Deposit">Deposit</option>
                <option value="Withdrawal">Withdrawal</option>
              </select>
            </label>
            <label>
              Amount
              <input
                type="number"
                step="any"
                min="0"
                required
                value={form.amount}
                onChange={(e) => handleChange('amount', e.target.value)}
              />
            </label>
            {form.transaction_type !== 'Withdrawal' && (
              <label>
                Deposit Type
                <select value={form.deposit_type} onChange={(e) => handleChange('deposit_type', e.target.value)}>
                  {DEPOSIT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
              {saving ? 'Saving…' : 'Save Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
