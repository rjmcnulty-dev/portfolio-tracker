import { useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Not a passive fetch-on-mount hook — lot data is only needed while editing
// a SELL trade, scoped to whatever ticker/account/trade is currently being
// edited, so callers fetch on demand rather than subscribing continuously.
export function useTradeLotAllocations() {
  // Open BUY lots for a ticker+account, annotated with remaining (unsold)
  // quantity. excludeSellTradeId lets an in-progress edit ignore its own
  // prior allocations when computing what's still available.
  const fetchOpenLots = useCallback(async (account, ticker, excludeSellTradeId) => {
    const { data: buyTrades, error: buyError } = await supabase
      .from('trades')
      .select('id, trade_date, quantity, price, cost_basis')
      .eq('account', account)
      .eq('ticker', ticker)
      .eq('trade_type', 'BUY')
      .order('trade_date', { ascending: true })
    if (buyError) throw buyError

    const buyIds = (buyTrades ?? []).map((t) => t.id)
    if (!buyIds.length) return []

    const { data: allocations, error: allocError } = await supabase
      .from('trade_lot_allocations')
      .select('buy_trade_id, sell_trade_id, quantity')
      .in('buy_trade_id', buyIds)
    if (allocError) throw allocError

    const closedByBuyId = new Map()
    for (const alloc of allocations ?? []) {
      if (excludeSellTradeId && alloc.sell_trade_id === excludeSellTradeId) continue
      closedByBuyId.set(alloc.buy_trade_id, (closedByBuyId.get(alloc.buy_trade_id) || 0) + Number(alloc.quantity))
    }

    return buyTrades
      .map((buy) => ({ ...buy, remaining: Number(buy.quantity) - (closedByBuyId.get(buy.id) || 0) }))
      .filter((lot) => lot.remaining > 1e-9)
  }, [])

  const fetchAllocationsForSell = useCallback(async (sellTradeId) => {
    const { data, error } = await supabase.from('trade_lot_allocations').select('*').eq('sell_trade_id', sellTradeId)
    if (error) throw error
    return data ?? []
  }, [])

  // Replaces all allocations for a sell with a fresh set — simplest way to
  // reconcile an edit without diffing old rows against new ones.
  const saveAllocationsForSell = useCallback(async (sellTradeId, allocations) => {
    const { error: deleteError } = await supabase
      .from('trade_lot_allocations')
      .delete()
      .eq('sell_trade_id', sellTradeId)
    if (deleteError) throw deleteError

    if (!allocations.length) return

    const rows = allocations.map((a) => ({
      sell_trade_id: sellTradeId,
      buy_trade_id: a.buy_trade_id,
      quantity: a.quantity,
      cost_basis: a.cost_basis,
    }))

    const { error: insertError } = await supabase.from('trade_lot_allocations').insert(rows)
    if (insertError) throw insertError
  }, [])

  return { fetchOpenLots, fetchAllocationsForSell, saveAllocationsForSell }
}
