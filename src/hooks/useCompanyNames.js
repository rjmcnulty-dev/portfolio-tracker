import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Batch-fetches company names for a list of tickers once (via the
// company-names Edge Function, Finnhub-only — see that function's comment
// for why this is cheap enough to call on every Prices page load rather
// than caching in the database like ticker_prices). Keeps a ref cache
// across re-renders so re-fetching only happens for tickers not already
// resolved, not the whole list every time `tickers` changes identity.
export function useCompanyNames(tickers) {
  const [names, setNames] = useState({})
  const cacheRef = useRef({})

  useEffect(() => {
    const missing = tickers.filter((t) => !(t in cacheRef.current))
    if (!missing.length) return

    let ignore = false

    supabase.functions
      .invoke('company-names', { body: { tickers: missing } })
      .then(({ data, error }) => {
        if (ignore || error || !data?.names) return
        cacheRef.current = { ...cacheRef.current, ...data.names }
        setNames(cacheRef.current)
      })
      .catch(() => {
        // Best effort — a missing company name just falls back to the
        // ticker itself in the UI, not worth surfacing as an error.
      })

    return () => {
      ignore = true
    }
  }, [tickers])

  return names
}
