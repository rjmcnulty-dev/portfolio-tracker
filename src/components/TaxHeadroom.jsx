import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './TaxHeadroom.css'

const CURRENT_YEAR = new Date().getFullYear()

const EMPTY_SETTINGS = {
  year: CURRENT_YEAR,
  filing_status: 'single',
  magi_ytd: '',
  target_bracket_ceiling: '',
  notes: '',
}

export default function TaxHeadroom() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('tax_settings')
        .select('*')
        .eq('year', CURRENT_YEAR)
        .maybeSingle()

      if (!ignore) {
        if (fetchError) {
          setError(fetchError.message)
        } else if (data) {
          setSettings(data)
        }
        setLoading(false)
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      year: CURRENT_YEAR,
      filing_status: settings.filing_status,
      magi_ytd: Number(settings.magi_ytd) || 0,
      target_bracket_ceiling: Number(settings.target_bracket_ceiling) || 0,
      notes: settings.notes,
    }

    const { error: saveError } = await supabase.from('tax_settings').upsert(payload, { onConflict: 'year' })

    setSaving(false)
    if (saveError) setError(saveError.message)
  }

  const headroom = (Number(settings.target_bracket_ceiling) || 0) - (Number(settings.magi_ytd) || 0)

  if (loading) return <div className="tax-card">Loading tax settings…</div>

  return (
    <div className="tax-card">
      <h3 className="tax-card__title">Tax Headroom — {CURRENT_YEAR}</h3>
      <form className="tax-form" onSubmit={handleSave}>
        <label>
          Filing Status
          <select
            value={settings.filing_status}
            onChange={(e) => setSettings((prev) => ({ ...prev, filing_status: e.target.value }))}
          >
            <option value="single">Single</option>
            <option value="married_joint">Married Filing Jointly</option>
          </select>
        </label>
        <label>
          YTD MAGI
          <input
            type="number"
            step="any"
            value={settings.magi_ytd}
            onChange={(e) => setSettings((prev) => ({ ...prev, magi_ytd: e.target.value }))}
          />
        </label>
        <label>
          Target Bracket Ceiling
          <input
            type="number"
            step="any"
            value={settings.target_bracket_ceiling}
            onChange={(e) => setSettings((prev) => ({ ...prev, target_bracket_ceiling: e.target.value }))}
          />
        </label>
        <label className="tax-form__notes">
          Notes
          <textarea
            value={settings.notes ?? ''}
            onChange={(e) => setSettings((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </label>

        <div className="tax-card__headroom">
          <span className="tax-card__headroom-label">Remaining Headroom</span>
          <span
            className={`tax-card__headroom-value ${headroom < 0 ? 'is-negative' : headroom > 0 ? 'is-positive' : ''}`}
          >
            {headroom.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </span>
        </div>

        {error && <p className="tax-form__error">{error}</p>}

        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </form>
    </div>
  )
}
