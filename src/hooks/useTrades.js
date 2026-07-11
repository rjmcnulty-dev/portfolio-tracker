import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useTrades(account = 'All') {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchTrades = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase.from('trades').select('*').order('trade_date', { ascending: false })
    if (account !== 'All') {
      query = query.eq('account', account)
    }

    const { data, error: fetchError } = await query

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
      const { error: deleteError } = await supabase.from('trades').delete().eq('id', id)
      if (deleteError) throw deleteError
      await fetchTrades()
    },
    [fetchTrades],
  )

  return { trades, loading, error, addTrade, updateTrade, deleteTrade, refetch: fetchTrades }
}
