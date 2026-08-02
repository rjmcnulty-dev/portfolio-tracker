import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useTrades(account = 'All') {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Guards against out-of-order responses: if account changes again (or a
  // manual refetch overlaps an in-flight auto-fetch) before this call's
  // response arrives, a later call's result must win — otherwise a slower,
  // stale request can resolve last and silently overwrite correct data with
  // the wrong account's trades.
  const latestRequestId = useRef(0)

  const fetchTrades = useCallback(async () => {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)

    let query = supabase.from('trades').select('*').order('trade_date', { ascending: false })
    if (account !== 'All') {
      query = query.eq('account', account)
    }

    const { data, error: fetchError } = await query

    if (requestId !== latestRequestId.current) return

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setTrades(data ?? [])
    }
    setLoading(false)
  }, [account])

  useEffect(() => {
    fetchTrades()
  }, [fetchTrades])

  const addTrade = useCallback(
    async (trade) => {
      const { error: insertError } = await supabase.from('trades').insert(trade)
      if (insertError) throw insertError
      await fetchTrades()
    },
    [fetchTrades],
  )

  const updateTrade = useCallback(
    async (id, updates) => {
      const { error: updateError } = await supabase.from('trades').update(updates).eq('id', id)
      if (updateError) throw updateError
      await fetchTrades()
    },
    [fetchTrades],
  )

  const deleteTrade = useCallback(
    async (id) => {
      // A BUY that's been (partially or fully) closed by a SELL can't be
      // deleted without corrupting that sell's realized P&L — the FK on
      // trade_lot_allocations.buy_trade_id blocks this at the DB level too
      // (no cascade there, on purpose), but that raw FK error isn't a useful
      // message, so check first and say specifically why.
      const { count, error: countError } = await supabase
        .from('trade_lot_allocations')
        .select('id', { count: 'exact', head: true })
        .eq('buy_trade_id', id)
      if (countError) throw countError
      if (count) {
        throw new Error(
          `Can't delete — this BUY trade closes ${count} sell allocation${count === 1 ? '' : 's'}. Delete the related SELL trade(s) first.`,
        )
      }

      const { error: deleteError } = await supabase.from('trades').delete().eq('id', id)
      if (deleteError) throw deleteError
      await fetchTrades()
    },
    [fetchTrades],
  )

  return { trades, loading, error, addTrade, updateTrade, deleteTrade, refetch: fetchTrades }
}
