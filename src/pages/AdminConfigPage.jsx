import { useEffect, useMemo, useState } from 'react'
import { useAppConfig } from '../hooks/useAppConfig'
import './AdminConfigPage.css'

// Every value shape (number, string, array, object) is edited as raw JSON —
// simpler and more honest than building a bespoke widget per key for a
// handful of settings, and it never falls out of sync with whatever shape a
// future config row happens to have.
function ConfigRow({ row, onSave }) {
  const [text, setText] = useState(() => JSON.stringify(row.value, null, 2))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    setText(JSON.stringify(row.value, null, 2))
  }, [row.value])

  async function handleSave() {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`)
      return
    }
    setError(null)
    setSaving(true)
    setJustSaved(false)
    try {
      await onSave(row.key, parsed)
      setJustSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-config__row">
      <div className="admin-config__row-header">
        <span className="admin-config__row-label">{row.label}</span>
        <span className="admin-config__row-updated">Updated {new Date(row.updated_at).toLocaleString()}</span>
      </div>
      {row.description && <p className="admin-config__row-description">{row.description}</p>}
      <textarea
        className="admin-config__row-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setJustSaved(false)
        }}
        spellCheck={false}
      />
      {error && <p className="admin-config__row-error">{error}</p>}
      <div className="admin-config__row-actions">
        <button className="btn btn--primary" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {justSaved && !error && <span className="admin-config__row-saved">Saved</span>}
      </div>
    </div>
  )
}

export default function AdminConfigPage() {
  const { configByKey, loading, error, updateConfig } = useAppConfig()

  const grouped = useMemo(() => {
    const byCategory = {}
    for (const row of Object.values(configByKey)) {
      if (!byCategory[row.category]) byCategory[row.category] = []
      byCategory[row.category].push(row)
    }
    for (const rows of Object.values(byCategory)) {
      rows.sort((a, b) => a.label.localeCompare(b.label))
    }
    return byCategory
  }, [configByKey])

  const categories = Object.keys(grouped).sort()

  if (loading) return <p className="page__loading">Loading settings…</p>
  if (error) return <p className="page__error">Error: {error}</p>
  if (!categories.length) {
    return (
      <p className="page__hint">
        No app_config rows found — run the "App settings" SQL migration from the README in the Supabase SQL editor.
      </p>
    )
  }

  return (
    <div className="admin-config">
      {categories.map((category) => (
        <section key={category} className="admin-config__category">
          <h3>{category}</h3>
          {grouped[category].map((row) => (
            <ConfigRow key={row.key} row={row} onSave={updateConfig} />
          ))}
        </section>
      ))}
    </div>
  )
}
