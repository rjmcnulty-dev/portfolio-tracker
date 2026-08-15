import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppConfig } from '../hooks/useAppConfig'
import './AdminConfigPage.css'

// Friendlier labels for the field names that actually appear across the
// seeded app_config values — falls back to a camelCase -> Title Case split
// for anything not listed here, so a future config key still gets a
// reasonable label with zero extra work.
const FIELD_LABELS = {
  maxPerWindow: 'Max requests per window',
  windowMs: 'Window length (ms)',
  stepDays: 'Step (days)',
  key: 'Key',
  label: 'Label',
  value: 'Value',
  days: 'Days',
  tolerancePct: 'Tolerance (decimal, e.g. 0.015 = 1.5%)',
  swingWindowPct: 'Swing window (decimal)',
  maxLevelsDefault: 'Max levels (default)',
  proximityPct: 'Proximity (decimal)',
  buyUpsidePct: 'Buy upside threshold (%)',
  buyMinScore: 'Buy min trend score',
  sellUpsidePct: 'Sell upside threshold (%)',
  sellMaxScoreNearResistance: 'Sell max score near resistance',
  defaultDayCount: 'Default day count',
  weekSize: 'Week size (days)',
  options: 'Page size options',
  default: 'Default page size',
}

function fieldLabel(key) {
  return FIELD_LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function compareNumericFirst(a, b) {
  const aIsNum = typeof a === 'number'
  const bIsNum = typeof b === 'number'
  if (aIsNum && bIsNum) return a - b
  if (aIsNum) return -1
  if (bIsNum) return 1
  return 0
}

// Sorts `items` ascending by number, with any non-numeric entries (e.g.
// holdings_page_size_options' "All") kept after every number — a no-op for
// a purely-string array like deposit_types, which has no numeric ordering to
// begin with. `ids` is a same-length array of stable per-item identities
// (see ArrayEditor) that gets permuted the identical way, so a field being
// actively typed into keeps its own DOM node — and the cursor/focus in
// it — as it moves to a new row, instead of React reusing whichever node
// now happens to occupy that index.
function sortNumericFirstPaired(items, ids) {
  if (!items.some((item) => typeof item === 'number')) return { items, ids }
  const paired = items.map((item, i) => ({ item, id: ids[i] })).sort((a, b) => compareNumericFirst(a.item, b.item))
  return { items: paired.map((p) => p.item), ids: paired.map((p) => p.id) }
}

// A field whose current value is null is always "number or absent" in this
// config set (stepDays, days) — never a null string — so empty clears it,
// a numeric string becomes a number, anything else is kept as typed.
function NullableField({ onChange }) {
  const [text, setText] = useState('')
  return (
    <input
      type="text"
      placeholder="(none)"
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        if (raw === '') return onChange(null)
        const n = Number(raw)
        onChange(Number.isNaN(n) ? raw : n)
      }}
    />
  )
}

function PrimitiveEditor({ value, onChange }) {
  if (typeof value === 'boolean') {
    return <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
  }
  if (typeof value === 'number') {
    return (
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    )
  }
  if (value === null) {
    return <NullableField onChange={onChange} />
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
}

function ObjectEditor({ value, onChange, inline }) {
  function updateField(key, newVal) {
    onChange({ ...value, [key]: newVal })
  }
  return (
    <div className={inline ? 'config-object config-object--inline' : 'config-object'}>
      {Object.keys(value).map((key) => (
        <label key={key} className="config-object__field">
          {fieldLabel(key)}
          <ConfigValueEditor value={value[key]} onChange={(v) => updateField(key, v)} />
        </label>
      ))}
    </div>
  )
}

function newId() {
  return Math.random().toString(36).slice(2)
}

function ArrayEditor({ value, onChange }) {
  const isObjectArray = value.length > 0 && value.every(isPlainObject)

  // Stable per-item identity, independent of each item's own value — lets
  // the array re-sort live, on every keystroke, while React keeps the same
  // DOM input (and the user's cursor/focus) attached to whichever item
  // they're actively editing, even as it visually moves to a new row. Without
  // this, index-based keys would make React reuse whatever input happens to
  // land at a given position after a sort, silently displaying a different
  // item's value in the field the user is still typing into.
  const idsRef = useRef(value.map(newId))
  if (idsRef.current.length !== value.length) {
    // Only reached if `value` changed from outside without going through
    // commit() below (e.g. ConfigRow resetting to a freshly-saved row) —
    // keeps ids and values the same length so every item still has one.
    idsRef.current = value.map((_, i) => idsRef.current[i] ?? newId())
  }

  function commit(nextValue, nextIds) {
    idsRef.current = nextIds
    onChange(nextValue)
  }

  function updateItem(index, newItem) {
    const nextValue = [...value]
    nextValue[index] = newItem

    // Live sort as soon as this array has a number in it — a pure string
    // list (e.g. deposit_types) has no numeric ordering, so it's left alone.
    if (!isObjectArray && nextValue.some((v) => typeof v === 'number')) {
      const { items, ids } = sortNumericFirstPaired(nextValue, idsRef.current)
      commit(items, ids)
      return
    }
    commit(nextValue, idsRef.current)
  }

  function removeItem(index) {
    commit(
      value.filter((_, i) => i !== index),
      idsRef.current.filter((_, i) => i !== index),
    )
  }

  function addItem() {
    if (isObjectArray) {
      const template = value[value.length - 1] ?? {}
      const blank = Object.fromEntries(
        Object.keys(template).map((k) => [k, typeof template[k] === 'number' ? 0 : '']),
      )
      commit([...value, blank], [...idsRef.current, newId()])
    } else {
      // Infer from whether *any* item is a number, not just the last one —
      // for an array like [25, 50, 100, "All"], the last element is a
      // string, so checking only that would create the new field as text,
      // and anything typed into it (e.g. "15") would be stored as the
      // string "15" rather than the number 15 — which no numeric sort can
      // ever recognize as sortable.
      const isNumericArray = value.some((item) => typeof item === 'number')
      commit([...value, isNumericArray ? 0 : ''], [...idsRef.current, newId()])
    }
  }

  return (
    <div className="config-array">
      {value.map((item, i) => (
        <div key={idsRef.current[i]} className="config-array__item">
          {isObjectArray ? (
            <ObjectEditor value={item} onChange={(next) => updateItem(i, next)} inline />
          ) : (
            <PrimitiveEditor value={item} onChange={(next) => updateItem(i, next)} />
          )}
          <button type="button" className="config-array__remove" title="Remove" onClick={() => removeItem(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn-link" onClick={addItem}>
        + Add
      </button>
    </div>
  )
}

function ConfigValueEditor({ value, onChange }) {
  if (Array.isArray(value)) return <ArrayEditor value={value} onChange={onChange} />
  if (isPlainObject(value)) return <ObjectEditor value={value} onChange={onChange} />
  return <PrimitiveEditor value={value} onChange={onChange} />
}

function ConfigRow({ row, onSave }) {
  const [value, setValue] = useState(row.value)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    setValue(row.value)
  }, [row.value])

  async function handleSave() {
    setError(null)
    setSaving(true)
    setJustSaved(false)
    try {
      await onSave(row.key, value)
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
      <ConfigValueEditor
        value={value}
        onChange={(next) => {
          setValue(next)
          setJustSaved(false)
        }}
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
