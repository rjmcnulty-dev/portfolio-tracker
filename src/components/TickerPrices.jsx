import { useMemo, useState } from 'react'
import { useTrades } from '../hooks/useTrades'
import { useTickerPrices } from '../hooks/useTickerPrices'
import { usePriceTargets } from '../hooks/usePriceTargets'
import { useAccounts } from '../hooks/useAccounts'
import { useCompanyNames } from '../hooks/useCompanyNames'
import { isBuyTrade } from '../lib/tradeTypes'
import './TickerPrices.css'

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatTimestamp(iso) {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function TickerPrices() {
  const { trades, loading: tradesLoading } = useTrades('All')
  const { prices, loading: pricesLoading, error, updatePrice, refreshAll, refreshOne } = useTickerPrices()
  const { targets, updateTarget } = usePriceTargets()
  const { accounts } = useAccounts()

  const [editingTicker, setEditingTicker] = useState(null)
  const [draftPrice, setDraftPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(null)
  const [refreshMessage, setRefreshMessage] = useState(null)
  const [autoUpdatingTicker, setAutoUpdatingTicker] = useState(null)
  const [autoUpdateError, setAutoUpdateError] = useState(null)

  const [editingTargetTicker, setEditingTargetTicker] = useState(null)
  const [draftTarget, setDraftTarget] = useState('')
  const [savingTarget, setSavingTarget] = useState(false)
  const [saveTargetError, setSaveTargetError] = useState(null)

  const tickers = useMemo(
    () => [...new Set(trades.map((t) => t.ticker).filter(Boolean))].sort(),
    [trades],
  )
  const companyNames = useCompanyNames(tickers)

  // Which accounts currently hold each ticker — same convention as holdings
  // elsewhere in the app: an open position is a BUY row, no lot-matching
  // against SELLs.
  const heldByTickerAccount = useMemo(() => {
    const map = new Map()
    for (const trade of trades) {
      if (!isBuyTrade(trade.trade_type)) continue
      if (!map.has(trade.ticker)) map.set(trade.ticker, new Set())
      map.get(trade.ticker).add(trade.account)
    }
    return map
  }, [trades])

  const lastRefreshed = useMemo(() => {
    const timestamps = Object.values(prices)
      .map((row) => row.updated_at)
      .filter(Boolean)
    if (!timestamps.length) return null
    return timestamps.reduce((latest, ts) => (ts > latest ? ts : latest))
  }, [prices])

  async function handleRefreshAll() {
    setRefreshing(true)
    setRefreshError(null)
    setRefreshMessage(null)
    try {
      const result = await refreshAll()
      setRefreshMessage(result?.message ?? 'Prices updated.')
    } catch (err) {
      setRefreshError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleAutoUpdate(ticker) {
    setAutoUpdatingTicker(ticker)
    setAutoUpdateError(null)
    try {
      await refreshOne(ticker)
    } catch (err) {
      setAutoUpdateError(`${ticker}: ${err.message}`)
    } finally {
      setAutoUpdatingTicker(null)
    }
  }

  function startEdit(ticker) {
    setEditingTicker(ticker)
    setDraftPrice(prices[ticker]?.price ?? '')
    setSaveError(null)
  }

  function cancelEdit() {
    setEditingTicker(null)
    setDraftPrice('')
    setSaveError(null)
  }

  async function handleSave(ticker) {
    if (draftPrice === '' || Number.isNaN(Number(draftPrice))) {
      setSaveError('Enter a valid price.')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      await updatePrice(ticker, draftPrice)
      setEditingTicker(null)
      setDraftPrice('')
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEditTarget(ticker) {
    setEditingTargetTicker(ticker)
    setDraftTarget(targets[ticker]?.target_price ?? '')
    setSaveTargetError(null)
  }

  function cancelEditTarget() {
    setEditingTargetTicker(null)
    setDraftTarget('')
    setSaveTargetError(null)
  }

  async function handleSaveTarget(ticker) {
    if (draftTarget === '' || Number.isNaN(Number(draftTarget))) {
      setSaveTargetError('Enter a valid price target.')
      return
    }

    setSavingTarget(true)
    setSaveTargetError(null)
    try {
      await updateTarget(ticker, draftTarget)
      setEditingTargetTicker(null)
      setDraftTarget('')
    } catch (err) {
      setSaveTargetError(err.message)
    } finally {
      setSavingTarget(false)
    }
  }

  if (tradesLoading || pricesLoading) return <div className="ticker-prices__empty">Loading prices…</div>
  if (error) return <div className="ticker-prices__empty">Error: {error}</div>
  if (!tickers.length) return <div className="ticker-prices__empty">No tickers yet — add a trade first.</div>

  return (
    <div className="ticker-prices-wrap">
      <div className="ticker-prices__toolbar">
        <span className="ticker-prices__last-refreshed">Last refreshed: {formatTimestamp(lastRefreshed)}</span>
        <button className="btn btn--primary" disabled={refreshing} onClick={handleRefreshAll}>
          {refreshing ? 'Updating…' : 'Update All Prices'}
        </button>
      </div>
      {refreshError && <p className="ticker-prices__error">{refreshError}</p>}
      {refreshMessage && !refreshError && <p className="ticker-prices__message success-message">{refreshMessage}</p>}
      <table className="ticker-prices">
        <thead>
          <tr>
            <th>Ticker</th>
            {accounts.map((account) => (
              <th key={account.id} className="is-held-col">
                {account.name}
              </th>
            ))}
            <th className="is-numeric">Current Price</th>
            <th>As Of</th>
            <th className="is-numeric">Price Target</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tickers.map((ticker) => {
            const row = prices[ticker]
            const isEditing = editingTicker === ticker
            const targetRow = targets[ticker]
            const isEditingTarget = editingTargetTicker === ticker
            return (
              <tr key={ticker}>
                <td className="ticker-prices__ticker" title={companyNames[ticker] || ticker}>
                  {ticker}
                </td>
                {accounts.map((account) => {
                  const isHeld = heldByTickerAccount.get(ticker)?.has(account.name)
                  return (
                    <td key={account.id} className="is-held-col">
                      {isHeld && <span className="held-dot" title={`Held in ${account.name}`} />}
                    </td>
                  )
                })}
                <td className="is-numeric">
                  {isEditing ? (
                    <input
                      type="number"
                      step="any"
                      autoFocus
                      value={draftPrice}
                      onChange={(e) => setDraftPrice(e.target.value)}
                    />
                  ) : (
                    formatCurrency(row?.price)
                  )}
                </td>
                <td>{row?.as_of ?? '—'}</td>
                <td className="is-numeric ticker-prices__target-cell">
                  {isEditingTarget ? (
                    <>
                      <input
                        type="number"
                        step="any"
                        autoFocus
                        value={draftTarget}
                        onChange={(e) => setDraftTarget(e.target.value)}
                      />
                      <button className="btn-link" disabled={savingTarget} onClick={() => handleSaveTarget(ticker)}>
                        {savingTarget ? 'Saving…' : 'Save'}
                      </button>
                      <button className="btn-link" disabled={savingTarget} onClick={cancelEditTarget}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {formatCurrency(targetRow?.target_price)}
                      <button className="btn-link" onClick={() => startEditTarget(ticker)}>
                        {targetRow ? 'Edit' : 'Set'}
                      </button>
                    </>
                  )}
                </td>
                <td className="ticker-prices__actions">
                  {isEditing ? (
                    <>
                      <button className="btn-link" disabled={saving} onClick={() => handleSave(ticker)}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className="btn-link" disabled={saving} onClick={cancelEdit}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn-link"
                        disabled={autoUpdatingTicker === ticker}
                        onClick={() => handleAutoUpdate(ticker)}
                      >
                        {autoUpdatingTicker === ticker ? 'Updating…' : 'Auto Update'}
                      </button>
                      <button className="btn-link" onClick={() => startEdit(ticker)}>
                        Manual Update
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {saveError && <p className="ticker-prices__error">{saveError}</p>}
      {autoUpdateError && <p className="ticker-prices__error">{autoUpdateError}</p>}
      {saveTargetError && <p className="ticker-prices__error">{saveTargetError}</p>}
    </div>
  )
}
