import { useEffect, useRef, useState } from 'react'
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

  useEffect(() => {
    if (!ticker) return

    const key = `${ticker}:${range}`
    let ignore = false

    async function load() {
      setLoading(true)
      setError(null)

      let entry = cacheRef.current.get(key)
      if (!entry) {
        entry = supabase.functions
          .invoke('watchlist-quote', { body: { ticker, range } })
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
        if (ignore) return
        setSeries(result.series)
        setNextEarningsDate(result.nextEarningsDate)
        setCompanyName(result.companyName)
      } catch (err) {
        if (ignore) return
        setError(err.message)
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [ticker, range])

  return { series, nextEarningsDate, companyName, loading, error }
}
