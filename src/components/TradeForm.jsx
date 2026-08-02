import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccounts } from '../hooks/useAccounts'
import { useTradeLotAllocations } from '../hooks/useTradeLotAllocations'
import { TRADE_TYPES } from '../lib/tradeTypes'
import './TradeForm.css'

const EMPTY_TRADE = {
  account: '',
  ticker: '',
  trade_type: 'BUY',
  quantity: '',
  price: '',
  trade_date: new Date().toISOString().slice(0, 10),
  fees: '0',
  cost_basis: '',
  market_price: '',
  market_value: '',
  realized_pnl: '0',
  unrealized_pnl: '0',
  wash_sale_risk: 'OK',
  notes: '',
}

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatQuantity(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function computeCostBasis(quantity, price, fees) {
  const total = (Number(quantity) || 0) * (Number(price) || 0) + (Number(fees) || 0)
  return total.toFixed(2)
}

// Realized P&L for a SELL = proceeds from this sale minus the cost basis of
// whichever BUY lot(s) it's allocated to close (proportional to how many
// shares of each lot are being closed).
function computeRealizedPnl(quantity, price, fees, openLots, allocations) {
  const proceeds = (Number(quantity) || 0) * (Number(price) || 0) - (Number(fees) || 0)
  let allocatedCostBasis = 0
  for (const lot of openLots) {
    const allocatedQty = Number(allocations[lot.id]) || 0
    if (!allocatedQty) continue
    const lotQty = Number(lot.quantity) || 0
    const perShareCost = lotQty > 0 ? (Number(lot.cost_basis) || 0) / lotQty : 0
    allocatedCostBasis += perShareCost * allocatedQty
  }
  return (proceeds - allocatedCostBasis).toFixed(2)
}

export default function TradeForm({ trade, onClose, onSaved }) {
  const { accounts, error: accountsError } = useAccounts()
  const { fetchOpenLots, fetchAllocationsForSell, saveAllocationsForSell } = useTradeLotAllocations()

  const [form, setForm] = useState(() => (trade ? { ...trade } : { ...EMPTY_TRADE }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [openLots, setOpenLots] = useState([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [lotsError, setLotsError] = useState(null)
  const [allocations, setAllocations] = useState({}) // { [buyTradeId]: quantityString }

  // Default to the first account once the list loads — it isn't available
  // synchronously at mount, unlike the old hardcoded array.
  useEffect(() => {
    if (trade || !accounts.length) return
    setForm((prev) => (prev.account ? prev : { ...prev, account: accounts[0].name }))
  }, [accounts, trade])

  // Preload this sell's existing lot allocations once, when editing one.
  useEffect(() => {
    if (!trade || trade.trade_type !== 'SELL') return
    let ignore = false
    fetchAllocationsForSell(trade.id)
      .then((rows) => {
        if (ignore) return
        const initial = {}
        for (const row of rows) initial[row.buy_trade_id] = String(row.quantity)
        setAllocations(initial)
      })
      .catch((err) => {
        if (!ignore) setLotsError(err.message)
      })
    return () => {
      ignore = true
    }
    // trade is only used for its stable id/type here; re-running on every
    // trade object identity change would refetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade?.id])

  // Load open BUY lots for the selected account/ticker whenever they change.
  // Excludes this sell's own prior allocations from "already closed" so its
  // previously-claimed shares show back up as available while editing.
  useEffect(() => {
    if (form.trade_type !== 'SELL' || !form.account || !form.ticker) {
      setOpenLots([])
      return
    }
    let ignore = false
    setLotsLoading(true)
    setLotsError(null)
    fetchOpenLots(form.account, form.ticker.toUpperCase(), trade?.id)
      .then((lots) => {
        if (!ignore) setOpenLots(lots)
      })
      .catch((err) => {
        if (!ignore) setLotsError(err.message)
      })
      .finally(() => {
        if (!ignore) setLotsLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [form.trade_type, form.account, form.ticker, trade?.id, fetchOpenLots])

  const allocatedTotal = useMemo(
    () => openLots.reduce((sum, lot) => sum + (Number(allocations[lot.id]) || 0), 0),
    [openLots, allocations],
  )

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Cost Basis (and, for a SELL, Realized P&L) auto-recalculate from
  // quantity/price/fees as they're edited. Both stay normal editable inputs
  // for the rare case a real value differs (e.g. a wash-sale adjustment).
  function handleCostInputChange(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      next.cost_basis = computeCostBasis(next.quantity, next.price, next.fees)
      if (next.trade_type === 'SELL') {
        next.realized_pnl = computeRealizedPnl(next.quantity, next.price, next.fees, openLots, allocations)
      }
      return next
    })
  }

  function handleRecalculateCostBasis() {
    setForm((prev) => ({ ...prev, cost_basis: computeCostBasis(prev.quantity, prev.price, prev.fees) }))
  }

  function handleRecalculateRealizedPnl() {
    setForm((prev) => ({
      ...prev,
      realized_pnl: computeRealizedPnl(prev.quantity, prev.price, prev.fees, openLots, allocations),
    }))
  }

  function handleAllocationChange(lotId, value) {
    const nextAllocations = { ...allocations, [lotId]: value }
    setAllocations(nextAllocations)
    setForm((prev) => ({
      ...prev,
      realized_pnl: computeRealizedPnl(prev.quantity, prev.price, prev.fees, openLots, nextAllocations),
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    const isSell = form.trade_type === 'SELL'

    if (isSell) {
      const qty = Number(form.quantity) || 0
      if (Math.abs(allocatedTotal - qty) > 1e-6) {
        setError(`Allocated ${formatQuantity(allocatedTotal)} share(s) to lots, but selling ${formatQuantity(qty)} — these must match exactly.`)
        return
      }
    }

    setSaving(true)

    const payload = {
      account: form.account,
      ticker: form.ticker.toUpperCase(),
      trade_type: form.trade_type,
      quantity: Number(form.quantity),
      price: Number(form.price),
      trade_date: form.trade_date,
      fees: Number(form.fees) || 0,
      cost_basis: Number(form.cost_basis) || 0,
      market_price: Number(form.market_price) || 0,
      market_value: Number(form.market_value) || 0,
      realized_pnl: Number(form.realized_pnl) || 0,
      unrealized_pnl: Number(form.unrealized_pnl) || 0,
      wash_sale_risk: form.wash_sale_risk,
      notes: form.notes,
    }

    const { data: savedTrade, error: saveError } = trade?.id
      ? await supabase.from('trades').update(payload).eq('id', trade.id).select().single()
      : await supabase.from('trades').insert(payload).select().single()

    if (saveError) {
      setSaving(false)
      setError(saveError.message)
      return
    }

    if (isSell) {
      try {
        const allocationRows = openLots
          .map((lot) => {
            const qty = Number(allocations[lot.id]) || 0
            if (!qty) return null
            const lotQty = Number(lot.quantity) || 0
            const perShareCost = lotQty > 0 ? (Number(lot.cost_basis) || 0) / lotQty : 0
            return { buy_trade_id: lot.id, quantity: qty, cost_basis: perShareCost * qty }
          })
          .filter(Boolean)
        await saveAllocationsForSell(savedTrade.id, allocationRows)
      } catch (err) {
        setSaving(false)
        setError(`Trade saved, but lot allocations failed: ${err.message}`)
        return
      }
    }

    setSaving(false)
    onSaved?.()
    onClose?.()
  }

  const allocationMatch = Math.abs(allocatedTotal - (Number(form.quantity) || 0)) < 1e-6

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">{trade?.id ? 'Edit Trade' : 'Add Trade'}</h2>
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
              Type
              <select value={form.trade_type} onChange={(e) => handleChange('trade_type', e.target.value)}>
                {TRADE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Trade Date
              <input
                type="date"
                required
                value={form.trade_date}
                onChange={(e) => handleChange('trade_date', e.target.value)}
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                step="any"
                required
                value={form.quantity}
                onChange={(e) => handleCostInputChange('quantity', e.target.value)}
              />
            </label>
            <label>
              Price
              <input
                type="number"
                step="any"
                required
                value={form.price}
                onChange={(e) => handleCostInputChange('price', e.target.value)}
              />
            </label>
            <label>
              Fees
              <input
                type="number"
                step="any"
                value={form.fees}
                onChange={(e) => handleCostInputChange('fees', e.target.value)}
              />
            </label>
            <label>
              <span className="trade-form__label-row">
                Cost Basis
                <button type="button" className="btn-link" onClick={handleRecalculateCostBasis}>
                  Recalculate
                </button>
              </span>
              <input
                type="number"
                step="any"
                value={form.cost_basis}
                onChange={(e) => handleChange('cost_basis', e.target.value)}
              />
            </label>
            <label>
              Market Price
              <input
                type="number"
                step="any"
                value={form.market_price}
                onChange={(e) => handleChange('market_price', e.target.value)}
              />
            </label>
            <label>
              Market Value
              <input
                type="number"
                step="any"
                value={form.market_value}
                onChange={(e) => handleChange('market_value', e.target.value)}
              />
            </label>
            <label>
              <span className="trade-form__label-row">
                Realized P&amp;L
                {form.trade_type === 'SELL' && (
                  <button type="button" className="btn-link" onClick={handleRecalculateRealizedPnl}>
                    Recalculate
                  </button>
                )}
              </span>
              <input
                type="number"
                step="any"
                value={form.realized_pnl}
                onChange={(e) => handleChange('realized_pnl', e.target.value)}
              />
            </label>
            <label>
              Unrealized P&amp;L
              <input
                type="number"
                step="any"
                value={form.unrealized_pnl}
                onChange={(e) => handleChange('unrealized_pnl', e.target.value)}
              />
            </label>
            <label>
              Wash Sale Risk
              <select value={form.wash_sale_risk} onChange={(e) => handleChange('wash_sale_risk', e.target.value)}>
                <option value="OK">OK</option>
                <option value="Review">Review</option>
                <option value="FLAGGED">FLAGGED</option>
              </select>
            </label>
            <label className="trade-form__notes">
              Notes
              <textarea value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} />
            </label>
          </div>

          {form.trade_type === 'SELL' && (
            <div className="trade-form__lots">
              <h3 className="trade-form__lots-title">Lots to Close</h3>
              {!form.account || !form.ticker ? (
                <p className="trade-form__hint">Select an account and ticker to see open lots.</p>
              ) : lotsLoading ? (
                <p className="trade-form__hint">Loading open lots…</p>
              ) : !openLots.length ? (
                <p className="trade-form__hint">
                  No open {form.ticker.toUpperCase()} lots in {form.account}.
                </p>
              ) : (
                <>
                  <table className="trade-form__lots-table">
                    <thead>
                      <tr>
                        <th>Bought</th>
                        <th className="is-numeric">Remaining</th>
                        <th className="is-numeric">Cost/Share</th>
                        <th className="is-numeric">Allocate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openLots.map((lot) => {
                        const lotQty = Number(lot.quantity) || 0
                        const perShareCost = lotQty > 0 ? (Number(lot.cost_basis) || 0) / lotQty : 0
                        return (
                          <tr key={lot.id}>
                            <td>{lot.trade_date}</td>
                            <td className="is-numeric">{formatQuantity(lot.remaining)}</td>
                            <td className="is-numeric">{formatCurrency(perShareCost)}</td>
                            <td className="is-numeric">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max={lot.remaining}
                                value={allocations[lot.id] ?? ''}
                                onChange={(e) => handleAllocationChange(lot.id, e.target.value)}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className={`trade-form__lots-total ${allocationMatch ? 'is-positive' : 'is-negative'}`}>
                    Allocated {formatQuantity(allocatedTotal)} of {formatQuantity(form.quantity || 0)} share(s)
                  </p>
                </>
              )}
              {lotsError && <p className="trade-form__error">{lotsError}</p>}
            </div>
          )}

          {error && <p className="trade-form__error">{error}</p>}

          <div className="trade-form__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
