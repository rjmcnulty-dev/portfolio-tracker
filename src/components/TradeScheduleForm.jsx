import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccounts } from '../hooks/useAccounts'
import { useConfigValue } from '../hooks/useAppConfig'
import './TradeForm.css'

const DEFAULT_FREQUENCIES = [
  { value: 'daily', label: 'Daily', stepDays: 1 },
  { value: 'weekly', label: 'Weekly', stepDays: 7 },
  { value: 'biweekly', label: 'Biweekly', stepDays: 14 },
  { value: 'monthly', label: 'Monthly', stepDays: null },
]

const EMPTY_SCHEDULE = {
  account: '',
  ticker: '',
  dollar_amount: '',
  frequency: 'monthly',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  active: true,
  notes: '',
}

export default function TradeScheduleForm({ schedule, onClose, onSaved }) {
  const { accounts, error: accountsError } = useAccounts()
  const FREQUENCIES = useConfigValue('recurring_frequencies', DEFAULT_FREQUENCIES)
  const [form, setForm] = useState(() =>
    schedule ? { ...schedule, end_date: schedule.end_date ?? '' } : { ...EMPTY_SCHEDULE },
  )
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

    const payload = {
      account: form.account,
      ticker: form.ticker.toUpperCase(),
      dollar_amount: Number(form.dollar_amount),
      frequency: form.frequency,
      start_date: form.start_date,
      end_date: form.end_date || null,
      active: form.active,
      notes: form.notes,
    }

    const { error: saveError } = schedule?.id
      ? await supabase.from('trade_schedules').update(payload).eq('id', schedule.id)
      : await supabase.from('trade_schedules').insert(payload)

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
        <h2 className="modal__title">{schedule?.id ? 'Edit Recurring Trade' : 'Add Recurring Trade'}</h2>
        <form className="trade-form" onSubmit={handleSubmit}>
          <div className="trade-form__grid">
            <label>
              Account
              <select value={form.account} onChange={(e) => handleChange('account', e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
              {accountsError && <span className="trade-form__error">Accounts failed to load: {accountsError}</span>}
            </label>
            <label>
              Ticker
              <input required value={form.ticker} onChange={(e) => handleChange('ticker', e.target.value)} />
            </label>
            <label>
              Dollar Amount
              <input
                type="number"
                step="any"
                required
                value={form.dollar_amount}
                onChange={(e) => handleChange('dollar_amount', e.target.value)}
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
            <label className="trade-form__notes">
              Notes
              <textarea value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} />
            </label>
          </div>

          <p className="trade-form__hint">
            Quantity is computed at materialization time as Dollar Amount ÷ the ticker's current cached price — the
            purchase "price" is whatever's in Prices at that moment, not fixed now.
          </p>

          {error && <p className="trade-form__error">{error}</p>}

          <div className="trade-form__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
