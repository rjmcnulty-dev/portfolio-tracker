import { useMemo } from 'react'
import { usePortfolio } from './usePortfolio'
import { isBuyTrade } from '../lib/tradeTypes'

// Which accounts currently hold each ticker — same "remaining_quantity > 0
// open BUY lot" definition of a holding used by AccountPage/Portfolio
// Stocks, just grouped by ticker instead of by account. Powers the "Held"
// banner on Stock Watch cards.
export function useHeldAccountsByTicker() {
  const { trades, loading } = usePortfolio('All')

  const heldAccountsByTicker = useMemo(() => {
    const map = new Map()
    for (const trade of trades) {
      if (!isBuyTrade(trade.trade_type)) continue
      if ((Number(trade.remaining_quantity) || 0) <= 0) continue
      const accounts = map.get(trade.ticker) ?? new Set()
      accounts.add(trade.account)
      map.set(trade.ticker, accounts)
    }
    return map
  }, [trades])

  return { heldAccountsByTicker, loading }
}
