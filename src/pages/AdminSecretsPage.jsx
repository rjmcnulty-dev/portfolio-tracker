import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './AdminSecretsPage.css'

const SECRETS = [
  { key: 'twelve_data_api_key', label: 'Twelve Data API Key' },
  { key: 'finnhub_api_key', label: 'Finnhub API Key' },
  { key: 'anthropic_api_key', label: 'Anthropic API Key' },
]

function SecretRow({ secretKey, label }) {
  const [status, setStatus] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    let ignore = false

    async function loadStatus() {
      setLoadingStatus(true)
      const { data, error: invokeError } = await supabase.functions.invoke('manage-secret', {
        body: { action: 'status', key: secretKey },
      })
      if (ignore) return
      if (invokeError) setError(invokeError.message)
      else if (data?.error) setError(data.error)
      else setStatus(data)
      setLoadingStatus(false)
    }

    loadStatus()
    return () => {
      ignore = true
    }
  }, [secretKey])

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    setPreview(null)

    const { data, error: invokeError } = await supabase.functions.invoke('manage-secret', {
      body: { action: 'save', key: secretKey, value: trimmed },
    })

    setSaving(false)
    if (invokeError) {
      setError(invokeError.message)
      return
    }
    if (data?.error) {
      setError(data.error)
      return
    }
    setPreview(data.preview)
    setStatus({ isSet: true, updatedAt: data.updatedAt })
    setValue('')
  }

  return (
    <div className="admin-secrets__row">
      <div className="admin-secrets__row-header">
        <span className="admin-secrets__row-label">{label}</span>
        {!loadingStatus && (
          <span className={`admin-secrets__row-status ${status?.isSet ? 'is-set' : 'is-unset'}`}>
            {status?.isSet ? `Configured · updated ${new Date(status.updatedAt).toLocaleString()}` : 'Not set'}
          </span>
        )}
      </div>
      <div className="admin-secrets__row-form">
        <input
          type="password"
          placeholder="Paste new value to update…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <button className="btn btn--primary" disabled={saving || !value.trim()} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {preview && <p className="admin-secrets__row-saved">Saved — {preview}</p>}
      {error && <p className="admin-secrets__row-error">{error}</p>}
    </div>
  )
}

export default function AdminSecretsPage() {
  return (
    <div className="admin-secrets">
      <p className="page__hint">
        Values are encrypted at rest and never sent back to the browser after saving — the page only ever shows
        whether a key is configured and when it was last updated, plus (right after a save) the last 4 characters of
        what you just typed, as confirmation.
      </p>
      {SECRETS.map((s) => (
        <SecretRow key={s.key} secretKey={s.key} label={s.label} />
      ))}
    </div>
  )
}
