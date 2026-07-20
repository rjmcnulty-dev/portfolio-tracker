import { useMemo } from 'react'
import { useTrades } from './useTrades'
import { useTickerPrices } from './useTickerPrices'
import { useDeposits } from './useDeposits'

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

  const loading = tradesLoading || depositsLoading
  const error = tradesError || depositsError

  // Live prices only overlay open (BUY) lots — a closed SELL lot's realized
  // P&L shouldn't be recomputed as if it still carried market exposure.
  const trades = useMemo(() => {
    return rawTrades.map((trade) => {
      const live = livePrices[trade.ticker]
      if (trade.trade_type !== 'BUY' || !live) return trade
      const marketValue = (Number(trade.quantity) || 0) * live.price
      return {
        ...trade,
        market_price: live.price,
        market_value: marketValue,
        unrealized_pnl: marketValue - (Number(trade.cost_basis) || 0),
      }
    })
  }, [rawTrades, livePrices])

  const totals = useMemo(() => {
    return trades.reduce(
      (acc, trade) => {
        acc.invested += Number(trade.cost_basis) || 0
        acc.marketValue += Number(trade.market_value) || 0
        acc.unrealizedPnl += Number(trade.unrealized_pnl) || 0
        acc.realizedPnl += Number(trade.realized_pnl) || 0
        return acc
      },
      { invested: 0, marketValue: 0, unrealizedPnl: 0, realizedPnl: 0 },
    )
  }, [trades])

  const kpis = useMemo(
    () => ({ ...totals, totalPnl: totals.realizedPnl + totals.unrealizedPnl }),
    [totals],
  )

  // Uninvested cash: deposits add, BUYs draw down by their cost, SELLs add
  // back their proceeds. Uses cost_basis for BUYs (reliable now that the
  // trade form auto-calculates it as qty * price + fees) and qty * price -
  // fees for SELL proceeds, independent of that row's own cost_basis (which
  // represents the basis of the shares sold, not cash received). Can go
  // negative if trades outspent recorded deposits — that's a real signal
  // (missing a deposit entry), not clamped away.
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

  // Per-stock position summary. Only BUY rows count as "held" shares — same
  // convention as the live-price overlay above, since this app doesn't do
  // lot-matching between BUY/SELL rows for a given ticker.
  const holdings = useMemo(() => {
    const byTicker = new Map()
    for (const trade of trades) {
      if (trade.trade_type !== 'BUY') continue
      const entry = byTicker.get(trade.ticker) || {
        ticker: trade.ticker,
        quantity: 0,
        costBasis: 0,
        costValue: 0,
        marketValue: 0,
      }
      const quantity = Number(trade.quantity) || 0
      entry.quantity += quantity
      entry.costBasis += Number(trade.cost_basis) || 0
      // quantity * price, independent of the (often blank or inconsistently
      // entered) cost_basis field — see avgCost below.
      entry.costValue += quantity * (Number(trade.price) || 0)
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
