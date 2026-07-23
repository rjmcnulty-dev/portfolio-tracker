import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchWatchlist = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('watchlist')
      .select('*')
      .order('ticker', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setWatchlist(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchWatchlist()
  }, [fetchWatchlist])

  const addTicker = useCallback(
    async (ticker, notes = '') => {
      const { error: insertError } = await supabase
        .from('watchlist')
        .insert({ ticker: ticker.trim().toUpperCase(), notes })
      if (insertError) throw insertError
      await fetchWatchlist()
    },
    [fetchWatchlist],
  )

  const updateNotes = useCallback(
    async (id, notes) => {
      const { error: updateError } = await supabase.from('watchlist').update({ notes }).eq('id', id)
      if (updateError) throw updateError
      await fetchWatchlist()
    },
    [fetchWatchlist],
  )

  const removeTicker = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from('watchlist').delete().eq('id', id)
      if (deleteError) throw deleteError
      await fetchWatchlist()
    },
    [fetchWatchlist],
  )

  return { watchlist, loading, error, addTicker, updateNotes, removeTicker, refetch: fetchWatchlist }
}
