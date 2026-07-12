import { useMemo } from 'react'
import { useTrades } from './useTrades'
import { useTickerPrices } from './useTickerPrices'

export function usePortfolio(account = 'All') {
  const { trades: rawTrades, loading, error, addTrade, updateTrade, deleteTrade, refetch } = useTrades(account)
  const { prices: livePrices } = useTickerPrices()

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

  return {
    trades,
    loading,
    error,
    kpis,
    allocation,
    pnlByTicker,
    addTrade,
    updateTrade,
    deleteTrade,
    refetch,
  }
}
