import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useTickerPrices() {
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase.from('ticker_prices').select('*')

      if (!ignore) {
        if (fetchError) {
          setError(fetchError.message)
        } else {
          const byTicker = {}
          for (const row of data ?? []) {
            byTicker[row.ticker] = row
          }
          setPrices(byTicker)
        }
        setLoading(false)
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  return { prices, loading, error }
}
