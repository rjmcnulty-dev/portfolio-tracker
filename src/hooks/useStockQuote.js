import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchWatchlistQuote, invalidateWatchlistQuote } from '../lib/twelveDataQueue'

export function useStockQuote(ticker, range) {
  const [series, setSeries] = useState([])
  const [nextEarningsDate, setNextEarningsDate] = useState(null)
  const [earningsDates, setEarningsDates] = useState([])
  const [recentEarningsDates, setRecentEarningsDates] = useState([])
  const [companyName, setCompanyName] = useState(null)
  const [floatShares, setFloatShares] = useState(null)
  const [sharesOutstanding, setSharesOutstanding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Guards against out-of-order responses (e.g. a manual refresh() overlaps
  // a range change) — only the most recently started load is allowed to
  // apply its result.
  const latestRequestId = useRef(0)

  const load = useCallback(async (currentTicker, currentRange) => {
    if (!currentTicker) return
    const requestId = ++latestRequestId.current

    setLoading(true)
    setError(null)

    try {
      // fetchWatchlistQuote caches/dedupes and rate-limits at module scope —
      // shared across every card, so any number of components asking for
      // the same (ticker, range) share one in-flight request and one queued
      // Twelve Data call, not one per instance.
      const { data, error: invokeError } = await fetchWatchlistQuote(currentTicker, currentRange, () =>
        supabase.functions.invoke('watchlist-quote', { body: { ticker: currentTicker, range: currentRange } }),
      )
      if (invokeError) throw invokeError
      if (data?.error) throw new Error(data.error)

      if (requestId !== latestRequestId.current) return
      setSeries(data.series ?? [])
      setNextEarningsDate(data.nextEarningsDate ?? null)
      setEarningsDates(data.earningsDates ?? [])
      setRecentEarningsDates(data.recentEarningsDates ?? [])
      setCompanyName(data.companyName ?? null)
      setFloatShares(data.floatShares ?? null)
      setSharesOutstanding(data.sharesOutstanding ?? null)
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
    invalidateWatchlistQuote(ticker)
    load(ticker, range)
  }, [ticker, range, load])

  return {
    series,
    nextEarningsDate,
    earningsDates,
    recentEarningsDates,
    companyName,
    floatShares,
    sharesOutstanding,
    loading,
    error,
    refresh,
  }
}
