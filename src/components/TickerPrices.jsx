import { useMemo, useState } from 'react'
import { usePortfolio } from '../hooks/usePortfolio'
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

function formatPercent(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`
}

function formatQuantity(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function pnlClass(value) {
  if (value > 0) return 'is-positive'
  if (value < 0) return 'is-negative'
  return 'is-neutral'
}

function formatTimestamp(iso) {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function TickerPrices() {
  const { accounts } = useAccounts()
  // Drives trades/holdings/pnlByTicker for the whole page — same "All" vs.
  // one-account scoping usePortfolio already supports everywhere else
  // (AccountPage, Portfolio Stocks), so filtering this page by account is
  // just passing a different value through, not new fetch/aggregation logic.
  const [selectedAccount, setSelectedAccount] = useState('All')
  const { trades, loading: tradesLoading, holdings, pnlByTicker } = usePortfolio(selectedAccount)
  const { prices, loading: pricesLoading, error, updatePrice, refreshAll, refreshOne } = useTickerPrices()
  const { targets, updateTarget } = usePriceTargets()

  // holdings only includes tickers with an open (remaining_quantity > 0)
  // position — a fully-closed ticker still shows up in `tickers` below (it
  // has trade history) but won't have an entry here, which renders as "—".
  const holdingByTicker = useMemo(() => new Map(holdings.map((h) => [h.ticker, h])), [holdings])

  // Total P/L = realized (closed lots) + unrealized (open position) across
  // the ticker's whole trade history — unlike Gain/Loss (unrealized only,
  // from `holdings`), this stays populated even for a fully-closed ticker.
  const totalPnlByTicker = useMemo(
    () => new Map(pnlByTicker.map((p) => [p.ticker, p.realized + p.unrealized])),
    [pnlByTicker],
  )

  // Open Gain/Loss % is blended (sum of $ / sum of cost basis), not an
  // average of each row's %, so it stays weighted by position size rather
  // than treating a small and a large holding's percent as equally
  // significant.
  const totals = useMemo(() => {
    const openGainLoss = holdings.reduce((sum, h) => sum + h.unrealizedPnl, 0)
    const openCostBasis = holdings.reduce((sum, h) => sum + h.costBasis, 0)
    const openGainLossPct = openCostBasis > 0 ? (openGainLoss / openCostBasis) * 100 : 0
    const totalPnl = pnlByTicker.reduce((sum, p) => sum + p.realized + p.unrealized, 0)
    return { openGainLoss, openGainLossPct, totalPnl }
  }, [holdings, pnlByTicker])

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

  // Shares currently held per (ticker, account) — sum of remaining_quantity
  // across that account's open BUY lots, same "open position" definition
  // used everywhere else in the app. When selectedAccount isn't 'All',
  // `trades` is already scoped to just that account, so every other
  // account's entry here is naturally absent (renders blank).
  const heldQtyByTickerAccount = useMemo(() => {
    const map = new Map()
    for (const trade of trades) {
      if (!isBuyTrade(trade.trade_type)) continue
      const qty = Number(trade.remaining_quantity) || 0
      if (qty <= 0) continue
      if (!map.has(trade.ticker)) map.set(trade.ticker, new Map())
      const byAccount = map.get(trade.ticker)
      byAccount.set(trade.account, (byAccount.get(trade.account) || 0) + qty)
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

  return (
    <div className="ticker-prices-wrap">
      <div className="ticker-prices__account-filter">
        <button
          type="button"
          className={`ticker-prices__account-btn ${selectedAccount === 'All' ? 'is-active' : ''}`}
          onClick={() => setSelectedAccount('All')}
        >
          All
        </button>
        {accounts.map((account) => (
          <button
            type="button"
            key={account.id}
            className={`ticker-prices__account-btn ${selectedAccount === account.name ? 'is-active' : ''}`}
            onClick={() => setSelectedAccount(account.name)}
          >
            {account.name}
          </button>
        ))}
      </div>

      {tradesLoading || pricesLoading ? (
        <div className="ticker-prices__empty">Loading prices…</div>
      ) : error ? (
        <div className="ticker-prices__empty">Error: {error}</div>
      ) : !tickers.length ? (
        <div className="ticker-prices__empty">
          No tickers {selectedAccount === 'All' ? '' : `in ${selectedAccount} `}yet — add a trade first.
        </div>
      ) : (
        <>
          <div className="ticker-prices__toolbar">
            <span className="ticker-prices__last-refreshed">Last refreshed: {formatTimestamp(lastRefreshed)}</span>
            <button className="btn btn--primary" disabled={refreshing} onClick={handleRefreshAll}>
              {refreshing ? 'Updating…' : 'Update All Prices'}
            </button>
          </div>
          {refreshError && <p className="ticker-prices__error">{refreshError}</p>}
          {refreshMessage && !refreshError && (
            <p className="ticker-prices__message success-message">{refreshMessage}</p>
          )}
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
                <th className="is-numeric">Open Gain/Loss</th>
                <th className="is-numeric" title="Realized + Unrealized P/L across this ticker's full trade history">
                  Total P/L
                </th>
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
                const holding = holdingByTicker.get(ticker)
                const totalPnl = totalPnlByTicker.get(ticker)
                return (
                  <tr key={ticker}>
                    <td className="ticker-prices__ticker" title={companyNames[ticker] || ticker}>
                      {ticker}
                    </td>
                    {accounts.map((account) => {
                      const qty = heldQtyByTickerAccount.get(ticker)?.get(account.name)
                      return (
                        <td key={account.id} className="is-held-col">
                          {qty ? formatQuantity(qty) : ''}
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
                    <td className={`is-numeric ${holding ? pnlClass(holding.unrealizedPnl) : ''}`}>
                      {holding
                        ? `${formatCurrency(holding.unrealizedPnl)} (${formatPercent(holding.unrealizedPct)})`
                        : '—'}
                    </td>
                    <td className={`is-numeric ${totalPnl != null ? pnlClass(totalPnl) : ''}`}>
                      {totalPnl != null ? formatCurrency(totalPnl) : '—'}
                    </td>
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
                          <button
                            className="btn-link"
                            disabled={savingTarget}
                            onClick={() => handleSaveTarget(ticker)}
                          >
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
            <tfoot>
              <tr className="ticker-prices__totals-row">
                <td>Totals</td>
                {accounts.map((account) => (
                  <td key={account.id} className="is-held-col"></td>
                ))}
                <td className="is-numeric"></td>
                <td></td>
                <td className={`is-numeric ${pnlClass(totals.openGainLoss)}`}>
                  {formatCurrency(totals.openGainLoss)} ({formatPercent(totals.openGainLossPct)})
                </td>
                <td className={`is-numeric ${pnlClass(totals.totalPnl)}`}>{formatCurrency(totals.totalPnl)}</td>
                <td className="is-numeric"></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          {saveError && <p className="ticker-prices__error">{saveError}</p>}
          {autoUpdateError && <p className="ticker-prices__error">{autoUpdateError}</p>}
          {saveTargetError && <p className="ticker-prices__error">{saveTargetError}</p>}
        </>
      )}
    </div>
  )
}
