import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useStockQuote(ticker, range) {
  const [series, setSeries] = useState([])
  const [nextEarningsDate, setNextEarningsDate] = useState(null)
  const [companyName, setCompanyName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Caches in-flight/resolved requests per "ticker:range" for this card's
  // lifetime. Two things this buys us: React StrictMode's dev-mode double
  // effect-fire shares one network call instead of issuing two (each
  // Twelve Data call costs a credit against an 8/minute free-tier budget),
  // and re-selecting a range you've already viewed is instant with no new
  // API call at all.
  const cacheRef = useRef(new Map())

  // Guards against out-of-order responses (e.g. a manual refresh() overlaps
  // a range change) — only the most recently started load is allowed to
  // apply its result.
  const latestRequestId = useRef(0)

  const load = useCallback(async (currentTicker, currentRange) => {
    if (!currentTicker) return
    const requestId = ++latestRequestId.current
    const key = `${currentTicker}:${currentRange}`

    setLoading(true)
    setError(null)

    let entry = cacheRef.current.get(key)
    if (!entry) {
      entry = supabase.functions
        .invoke('watchlist-quote', { body: { ticker: currentTicker, range: currentRange } })
        .then(({ data, error: invokeError }) => {
          if (invokeError) throw invokeError
          if (data?.error) throw new Error(data.error)
          return {
            series: data.series ?? [],
            nextEarningsDate: data.nextEarningsDate ?? null,
            companyName: data.companyName ?? null,
          }
        })
        .catch((err) => {
          cacheRef.current.delete(key)
          throw err
        })
      cacheRef.current.set(key, entry)
    }

    try {
      const result = await entry
      if (requestId !== latestRequestId.current) return
      setSeries(result.series)
      setNextEarningsDate(result.nextEarningsDate)
      setCompanyName(result.companyName)
    } catch (err) {
      if (requestId !== latestRequestId.current) return
      setError(err.message)
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(ticker, range)
  }, [ticker, range, load])

  // Manual per-ticker refresh: drop every cached range for this ticker (the
  // underlying price data changed, so a previously-viewed range's cached
  // series is stale too, not just the one on screen right now) and reload
  // the currently selected range.
  const refresh = useCallback(() => {
    if (!ticker) return
    for (const key of [...cacheRef.current.keys()]) {
      if (key.startsWith(`${ticker}:`)) cacheRef.current.delete(key)
    }
    load(ticker, range)
  }, [ticker, range, load])

  return { series, nextEarningsDate, companyName, loading, error, refresh }
}
