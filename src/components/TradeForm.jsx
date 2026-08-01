import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccounts } from '../hooks/useAccounts'
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

function computeCostBasis(quantity, price, fees) {
  const total = (Number(quantity) || 0) * (Number(price) || 0) + (Number(fees) || 0)
  return total.toFixed(2)
}

export default function TradeForm({ trade, onClose, onSaved }) {
  const { accounts } = useAccounts()
  const [form, setForm] = useState(() => (trade ? { ...trade } : { ...EMPTY_TRADE }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Default to the first account once the list loads — it isn't available
  // synchronously at mount, unlike the old hardcoded array.
  useEffect(() => {
    if (trade || !accounts.length) return
    setForm((prev) => (prev.account ? prev : { ...prev, account: accounts[0].name }))
  }, [accounts, trade])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Cost Basis auto-recalculates from quantity/price/fees as they're edited,
  // so the common case (basis = qty * price + fees) needs no manual entry.
  // It stays a normal editable input for the rare case a real cost basis
  // differs (e.g. a wash-sale-adjusted carryover).
  function handleCostInputChange(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      next.cost_basis = computeCostBasis(next.quantity, next.price, next.fees)
      return next
    })
  }

  function handleRecalculateCostBasis() {
    setForm((prev) => ({ ...prev, cost_basis: computeCostBasis(prev.quantity, prev.price, prev.fees) }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

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

    const { error: saveError } = trade?.id
      ? await supabase.from('trades').update(payload).eq('id', trade.id)
      : await supabase.from('trades').insert(payload)

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
            </label>
            <label>
              Ticker
              <input required value={form.ticker} onChange={(e) => handleChange('ticker', e.target.value)} />
            </label>
            <label>
              Type
              <select value={form.trade_type} onChange={(e) => handleChange('trade_type', e.target.value)}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
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
              Realized P&amp;L
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
