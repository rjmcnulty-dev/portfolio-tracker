import { useState } from 'react'
import { useBenchmarks } from '../hooks/useBenchmarks'
import { useTickerPrices } from '../hooks/useTickerPrices'
import ConfirmDialog from '../components/ConfirmDialog'
import './AdminBenchmarksPage.css'

// Cycled through for a new benchmark's default color, same swatches used
// elsewhere in the app (src/index.css custom properties).
const PALETTE = ['#2a78d6', '#8b5cf6', '#F0A500', '#1baf7a', '#e34948', '#7dd3fc']

// No is_core/protected-row concept here (unlike AdminTradeTypesPage) — every
// row, including the seeded S&P 500/Nasdaq/Dow Jones, is freely editable and
// deletable. See "Benchmarks" in the README for why.
export default function AdminBenchmarksPage() {
  const { benchmarks, loading, error, addBenchmark, updateBenchmark, moveBenchmark, deleteBenchmark } = useBenchmarks()
  const { refreshOne } = useTickerPrices()

  const [newTicker, setNewTicker] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)

  const [editingTicker, setEditingTicker] = useState(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [savingTicker, setSavingTicker] = useState(null)
  const [rowError, setRowError] = useState(null)

  const [confirmingDelete, setConfirmingDelete] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

  async function handleAdd(event) {
    event.preventDefault()
    setAdding(true)
    setAddError(null)
    let insertedTicker = null
    try {
      insertedTicker = await addBenchmark(newTicker, newName, newColor)
      // Validates the ticker against Twelve Data and seeds a real first
      // price in the same step — the single-ticker path the Prices page's
      // "Auto Update" button already uses. A bad ticker is caught here
      // rather than silently sitting in the table with no price ever.
      await refreshOne(insertedTicker)
      setNewTicker('')
      setNewName('')
      setNewColor(PALETTE[(benchmarks.length + 1) % PALETTE.length])
    } catch (err) {
      if (insertedTicker) await deleteBenchmark(insertedTicker).catch(() => {})
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  function startEdit(benchmark) {
    setEditingTicker(benchmark.ticker)
    setEditName(benchmark.name)
    setEditColor(benchmark.color)
    setRowError(null)
  }

  async function handleSaveEdit(ticker) {
    setSavingTicker(ticker)
    setRowError(null)
    try {
      await updateBenchmark(ticker, { name: editName, color: editColor })
      setEditingTicker(null)
    } catch (err) {
      setRowError(`${ticker}: ${err.message}`)
    } finally {
      setSavingTicker(null)
    }
  }

  async function handleConfirmDelete() {
    const benchmark = confirmingDelete
    setConfirmingDelete(null)
    setDeleteError(null)
    try {
      await deleteBenchmark(benchmark.ticker)
    } catch (err) {
      setDeleteError(err.message)
    }
  }

  if (loading) return <p className="page__loading">Loading benchmarks…</p>
  if (error) return <p className="page__error">Error: {error}</p>

  return (
    <div className="admin-benchmarks">
      <table className="admin-benchmarks__table">
        <thead>
          <tr>
            <th></th>
            <th>Color</th>
            <th>Ticker</th>
            <th>Name</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {benchmarks.map((benchmark, index) => {
            const isEditing = editingTicker === benchmark.ticker
            return (
              <tr key={benchmark.ticker}>
                <td className="admin-benchmarks__move">
                  <button
                    type="button"
                    className="btn-link"
                    disabled={index === 0}
                    onClick={() => moveBenchmark(benchmark.ticker, 'up')}
                    aria-label={`Move ${benchmark.name} up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="btn-link"
                    disabled={index === benchmarks.length - 1}
                    onClick={() => moveBenchmark(benchmark.ticker, 'down')}
                    aria-label={`Move ${benchmark.name} down`}
                  >
                    ▼
                  </button>
                </td>
                <td>
                  {isEditing ? (
                    <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} />
                  ) : (
                    <span className="admin-benchmarks__swatch" style={{ background: benchmark.color }} />
                  )}
                </td>
                <td className="admin-benchmarks__ticker">{benchmark.ticker}</td>
                <td>
                  {isEditing ? (
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  ) : (
                    benchmark.name
                  )}
                </td>
                <td className="admin-benchmarks__actions">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={savingTicker === benchmark.ticker}
                        onClick={() => handleSaveEdit(benchmark.ticker)}
                      >
                        {savingTicker === benchmark.ticker ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="btn-link" onClick={() => setEditingTicker(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-link" onClick={() => startEdit(benchmark)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-link btn-link--danger"
                        onClick={() => setConfirmingDelete(benchmark)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rowError && <p className="admin-benchmarks__error">{rowError}</p>}
      {deleteError && <p className="admin-benchmarks__error">{deleteError}</p>}

      <form className="admin-benchmarks__add-form" onSubmit={handleAdd}>
        <label>
          Ticker
          <input required placeholder="e.g. IWM" value={newTicker} onChange={(e) => setNewTicker(e.target.value)} />
        </label>
        <label>
          Name
          <input required placeholder="e.g. Russell 2000" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label className="admin-benchmarks__color-label">
          Color
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
        </label>
        {addError && <p className="admin-benchmarks__error">{addError}</p>}
        <button type="submit" className="btn btn--primary" disabled={adding}>
          {adding ? 'Adding…' : '+ Add Benchmark'}
        </button>
      </form>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete benchmark?"
          message={`Delete "${confirmingDelete.name}" (${confirmingDelete.ticker})? This only removes it from the comparison chart — it doesn't affect any held position using the same ticker.`}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  )
}
