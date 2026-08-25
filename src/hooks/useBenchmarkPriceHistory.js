import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Fetches ticker_price_history for a set of benchmark tickers in one query,
// grouped client-side into Map<ticker, [{as_of, price}, ...]> (ascending by
// date). `tickers` changes whenever the CRUD list or the chart's visibility
// toggle changes, so out-of-order responses are guarded against the same way
// usePortfolioValueHistory does. Callers should pass a memoized array (see
// BenchmarkComparisonChart's visibleTickers) so this doesn't refetch every
// render on an incidental new-array-same-contents reference.
//
// `fromDate`/`toDate` (optional, 'YYYY-MM-DD') bound the query to
// fromDate <= as_of <= toDate. Bounding isn't just an optimization —
// PostgREST caps an unbounded query at 1000 rows by default. A
// fully-backfilled benchmark has ~5000 rows, so an unbounded fetch silently
// returns only the oldest 1000 (ascending order), leaving the price cursor
// stuck on decade-old prices for every date in the visible range. Bounding
// to what the chart actually needs avoids relying on that row count staying
// under the cap at all.
export function useBenchmarkPriceHistory(tickers, fromDate = null, toDate = null) {
  const [historyByTicker, setHistoryByTicker] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const latestRequestId = useRef(0)

  const fetchHistory = useCallback(async () => {
    const requestId = ++latestRequestId.current

    if (!tickers.length) {
      setHistoryByTicker(new Map())
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    let query = supabase.from('ticker_price_history').select('ticker, as_of, price').in('ticker', tickers)
    if (fromDate) query = query.gte('as_of', fromDate)
    if (toDate) query = query.lte('as_of', toDate)
    const { data, error: fetchError } = await query.order('as_of', { ascending: true })

    if (requestId !== latestRequestId.current) return

    if (fetchError) {
      setError(fetchError.message)
    } else {
      const map = new Map()
      for (const row of data ?? []) {
        if (!map.has(row.ticker)) map.set(row.ticker, [])
        map.get(row.ticker).push({ as_of: row.as_of, price: Number(row.price) })
      }
      setHistoryByTicker(map)
    }
    setLoading(false)
  }, [tickers, fromDate, toDate])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  return { historyByTicker, loading, error, refetch: fetchHistory }
}
