import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Mirrors useTickerPrices.js's shape — a plain ticker-keyed map, set
// manually per ticker (no external API, since analyst price targets aren't
// available on the free-tier APIs this app otherwise uses).
export function usePriceTargets() {
  const [targets, setTargets] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchTargets = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase.from('price_targets').select('*')

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      const byTicker = {}
      for (const row of data ?? []) {
        byTicker[row.ticker] = row
      }
      setTargets(byTicker)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTargets()
  }, [fetchTargets])

  const updateTarget = useCallback(
    async (ticker, targetPrice) => {
      const { error: upsertError } = await supabase.from('price_targets').upsert(
        { ticker, target_price: Number(targetPrice), updated_at: new Date().toISOString() },
        { onConflict: 'ticker' },
      )
      if (upsertError) throw upsertError
      await fetchTargets()
    },
    [fetchTargets],
  )

  return { targets, loading, error, updateTarget, refetch: fetchTargets }
}
