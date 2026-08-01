import { useEffect, useMemo, useState } from 'react'
import { useTrades } from './useTrades'
import { useTickerPrices } from './useTickerPrices'
import { useDeposits } from './useDeposits'
import { supabase } from '../lib/supabase'

export function usePortfolio(account = 'All') {
  const {
    trades: rawTrades,
    loading: tradesLoading,
    error: tradesError,
    addTrade,
    updateTrade,
    deleteTrade,
    refetch,
  } = useTrades(account)
  const { prices: livePrices } = useTickerPrices()
  const { deposits, loading: depositsLoading, error: depositsError } = useDeposits(account)

  // Closed (allocated-to-a-sell) quantity per BUY trade id, so a partially
  // or fully sold lot doesn't keep counting its full original size toward
  // holdings/market value. Fetched unfiltered by account — it's a small
  // dataset for a personal portfolio, and simpler than re-deriving per view.
  const [closedByBuyId, setClosedByBuyId] = useState(new Map())
  const [allocationsError, setAllocationsError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function loadAllocations() {
      const { data, error: fetchError } = await supabase.from('trade_lot_allocations').select('buy_trade_id, quantity')
      if (ignore) return

      if (fetchError) {
        setAllocationsError(fetchError.message)
        return
      }

      setAllocationsError(null)
      const map = new Map()
      for (const row of data ?? []) {
        map.set(row.buy_trade_id, (map.get(row.buy_trade_id) || 0) + Number(row.quantity))
      }
      setClosedByBuyId(map)
    }

    loadAllocations()
    return () => {
      ignore = true
    }
  }, [rawTrades])

  const loading = tradesLoading || depositsLoading
  const error = tradesError || depositsError || allocationsError

  // Live prices only overlay open (BUY) lots, using each lot's REMAINING
  // (post-sale) quantity rather than its original quantity — a partially or
  // fully closed lot shouldn't still carry its full original market
  // exposure. cost_basis/quantity/price on the row itself stay untouched
  // (they're the accurate historical record of that transaction); only the
  // derived market_price/market_value/unrealized_pnl are recomputed, plus
  // two new remaining_quantity/remaining_cost_basis fields for holdings.
  const trades = useMemo(() => {
    return rawTrades.map((trade) => {
      if (trade.trade_type !== 'BUY') return trade

      const originalQty = Number(trade.quantity) || 0
      const closedQty = closedByBuyId.get(trade.id) || 0
      const remainingQty = Math.max(0, originalQty - closedQty)
      const remainingCostBasis = originalQty > 0 ? (Number(trade.cost_basis) || 0) * (remainingQty / originalQty) : 0

      const live = livePrices[trade.ticker]
      const marketPrice = live ? live.price : Number(trade.market_price) || 0
      const marketValue = remainingQty * marketPrice

      return {
        ...trade,
        remaining_quantity: remainingQty,
        remaining_cost_basis: remainingCostBasis,
        market_price: marketPrice,
        market_value: marketValue,
        unrealized_pnl: marketValue - remainingCostBasis,
      }
    })
  }, [rawTrades, livePrices, closedByBuyId])

  const totals = useMemo(() => {
    return trades.reduce(
      (acc, trade) => {
        if (trade.trade_type === 'BUY') {
          acc.invested += Number(trade.remaining_cost_basis) || 0
          acc.marketValue += Number(trade.market_value) || 0
          acc.unrealizedPnl += Number(trade.unrealized_pnl) || 0
        } else if (trade.trade_type === 'SELL') {
          acc.realizedPnl += Number(trade.realized_pnl) || 0
        }
        return acc
      },
      { invested: 0, marketValue: 0, unrealizedPnl: 0, realizedPnl: 0 },
    )
  }, [trades])

  const kpis = useMemo(
    () => ({ ...totals, totalPnl: totals.realizedPnl + totals.unrealizedPnl }),
    [totals],
  )

  // Uninvested cash: deposits add, BUYs draw down by their original cost,
  // SELLs add back their proceeds. Uses cost_basis for BUYs (reliable now
  // that the trade form auto-calculates it as qty * price + fees) and
  // qty * price - fees for SELL proceeds, independent of that row's own
  // cost_basis (which represents the basis of the shares sold, not cash
  // received). Can go negative if trades outspent recorded deposits —
  // that's a real signal (missing a deposit entry), not clamped away.
  const cashPosition = useMemo(() => {
    const totalDeposits = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0)
    const netTradeCash = trades.reduce((sum, trade) => {
      const quantity = Number(trade.quantity) || 0
      const price = Number(trade.price) || 0
      const fees = Number(trade.fees) || 0
      if (trade.trade_type === 'BUY') return sum - (Number(trade.cost_basis) || 0)
      if (trade.trade_type === 'SELL') return sum + (quantity * price - fees)
      return sum
    }, 0)
    return totalDeposits + netTradeCash
  }, [deposits, trades])

  const allocation = useMemo(() => {
    const byTicker = new Map()
    for (const trade of trades) {
      const value = Number(trade.market_value) || 0
      byTicker.set(trade.ticker, (byTicker.get(trade.ticker) || 0) + value)
    }
    const total = [...byTicker.values()].reduce((sum, value) => sum + value, 0)
    return [...byTicker.entries()]
      .map(([ticker, value]) => ({
        ticker,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value)
  }, [trades])

  const pnlByTicker = useMemo(() => {
    const byTicker = new Map()
    for (const trade of trades) {
      const entry = byTicker.get(trade.ticker) || { ticker: trade.ticker, realized: 0, unrealized: 0 }
      entry.realized += Number(trade.realized_pnl) || 0
      entry.unrealized += Number(trade.unrealized_pnl) || 0
      byTicker.set(trade.ticker, entry)
    }
    return [...byTicker.values()].sort(
      (a, b) => b.realized + b.unrealized - (a.realized + a.unrealized),
    )
  }, [trades])

  // Per-stock position summary, using each BUY lot's REMAINING quantity —
  // a fully-closed lot (remaining_quantity 0) no longer counts as a holding.
  const holdings = useMemo(() => {
    const byTicker = new Map()
    for (const trade of trades) {
      if (trade.trade_type !== 'BUY') continue
      const remainingQty = Number(trade.remaining_quantity) || 0
      if (remainingQty <= 0) continue

      const entry = byTicker.get(trade.ticker) || {
        ticker: trade.ticker,
        quantity: 0,
        costBasis: 0,
        costValue: 0,
        marketValue: 0,
      }
      entry.quantity += remainingQty
      entry.costBasis += Number(trade.remaining_cost_basis) || 0
      // quantity * price, independent of the (often blank or inconsistently
      // entered) cost_basis field — see avgCost below.
      entry.costValue += remainingQty * (Number(trade.price) || 0)
      entry.marketValue += Number(trade.market_value) || 0
      byTicker.set(trade.ticker, entry)
    }

    return [...byTicker.values()]
      .map(({ costValue, ...entry }) => {
        const unrealizedPnl = entry.marketValue - entry.costBasis
        return {
          ...entry,
          // Weighted average execution price, not cost_basis / quantity —
          // cost_basis is a free-entry field that's frequently left blank or
          // filled in with the per-share price instead of the lot total,
          // which makes it an unreliable basis for "average cost per share".
          avgCost: entry.quantity > 0 ? costValue / entry.quantity : 0,
          currentPrice: entry.quantity > 0 ? entry.marketValue / entry.quantity : 0,
          unrealizedPnl,
          unrealizedPct: entry.costBasis > 0 ? (unrealizedPnl / entry.costBasis) * 100 : 0,
        }
      })
      .sort((a, b) => b.marketValue - a.marketValue)
  }, [trades])

  return {
    trades,
    loading,
    error,
    kpis,
    allocation,
    pnlByTicker,
    holdings,
    cashPosition,
    addTrade,
    updateTrade,
    deleteTrade,
    refetch,
  }
}
