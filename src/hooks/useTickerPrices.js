import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useTickerPrices() {
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchPrices = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase.from('ticker_prices').select('*')

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      const byTicker = {}
      for (const row of data ?? []) {
        byTicker[row.ticker] = row
      }
      setPrices(byTicker)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPrices()
  }, [fetchPrices])

  const updatePrice = useCallback(
    async (ticker, price) => {
      const { error: upsertError } = await supabase.from('ticker_prices').upsert(
        {
          ticker,
          price: Number(price),
          as_of: new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'ticker' },
      )
      if (upsertError) throw upsertError
      await fetchPrices()
    },
    [fetchPrices],
  )

  const refreshAll = useCallback(async () => {
    const { data, error: invokeError } = await supabase.functions.invoke('refresh-prices')
    if (invokeError) throw invokeError
    if (data?.error) throw new Error(data.error)
    await fetchPrices()
    return data
  }, [fetchPrices])

  const refreshOne = useCallback(
    async (ticker) => {
      const { data, error: invokeError } = await supabase.functions.invoke('refresh-prices', { body: { ticker } })
      if (invokeError) throw invokeError
      if (data?.error) throw new Error(data.error)
      await fetchPrices()
      return data
    },
    [fetchPrices],
  )

  return { prices, loading, error, updatePrice, refreshAll, refreshOne, refetch: fetchPrices }
}
