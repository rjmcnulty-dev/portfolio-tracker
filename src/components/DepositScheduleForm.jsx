import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccounts } from '../hooks/useAccounts'
import { useConfigValue } from '../hooks/useAppConfig'
import './DepositForm.css'

const DEFAULT_FREQUENCIES = [
  { value: 'daily', label: 'Daily', stepDays: 1 },
  { value: 'weekly', label: 'Weekly', stepDays: 7 },
  { value: 'biweekly', label: 'Biweekly', stepDays: 14 },
  { value: 'monthly', label: 'Monthly', stepDays: null },
]

const DEFAULT_DEPOSIT_TYPES = ['Cash Deposit', 'Rollover', 'Short Term Capital Gain', 'Long Term Capital Gain', 'Dividend']

const EMPTY_SCHEDULE = {
  account: '',
  transaction_type: 'Deposit',
  amount: '',
  frequency: 'monthly',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  active: true,
  deposit_type: DEFAULT_DEPOSIT_TYPES[0],
  notes: '',
}

// Same negative-amount convention as DepositForm.jsx — a recurring
// withdrawal (e.g. a monthly RMD) is just a schedule whose materialized
// occurrences carry a negative amount.
function toFormState(schedule) {
  const amount = Number(schedule.amount) || 0
  return {
    ...schedule,
    end_date: schedule.end_date ?? '',
    transaction_type: amount < 0 ? 'Withdrawal' : 'Deposit',
    amount: Math.abs(amount),
  }
}

export default function DepositScheduleForm({ schedule, onClose, onSaved }) {
  const { accounts, error: accountsError } = useAccounts()
  const FREQUENCIES = useConfigValue('recurring_frequencies', DEFAULT_FREQUENCIES)
  const DEPOSIT_TYPES = useConfigValue('deposit_types', DEFAULT_DEPOSIT_TYPES)
  const [form, setForm] = useState(() => (schedule ? toFormState(schedule) : { ...EMPTY_SCHEDULE }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (schedule || !accounts.length) return
    setForm((prev) => (prev.account ? prev : { ...prev, account: accounts[0].name }))
  }, [accounts, schedule])

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
      frequency: form.frequency,
      start_date: form.start_date,
      end_date: form.end_date || null,
      active: form.active,
      deposit_type: form.deposit_type,
      notes: form.notes,
    }

    const { error: saveError } = schedule?.id
      ? await supabase.from('deposit_schedules').update(payload).eq('id', schedule.id)
      : await supabase.from('deposit_schedules').insert(payload)

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
        <h2 className="modal__title">{schedule?.id ? 'Edit Recurring Transaction' : 'Add Recurring Transaction'}</h2>
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
            <label>
              Frequency
              <select value={form.frequency} onChange={(e) => handleChange('frequency', e.target.value)}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start Date
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
              />
            </label>
            <label>
              End Date (optional)
              <input type="date" value={form.end_date} onChange={(e) => handleChange('end_date', e.target.value)} />
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
              Active
              <select
                value={form.active ? 'yes' : 'no'}
                onChange={(e) => handleChange('active', e.target.value === 'yes')}
              >
                <option value="yes">Yes</option>
                <option value="no">No (paused)</option>
              </select>
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
              {saving ? 'Saving…' : 'Save Recurring Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
