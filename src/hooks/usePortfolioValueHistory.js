import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// account='All' reads the whole-portfolio table (one row per day, every
// account combined); any real account name reads the per-account table
// instead — they're separate tables (see README) rather than one table with
// an 'All' sentinel, since 'All' isn't a real row in `accounts` and would
// break account_value_history's foreign key. Both are written going forward
// by scripts/fetch-prices.mjs / the refresh-prices Edge Function, and
// scripts/backfill-portfolio-history.mjs for everything before this feature
// shipped. Fetched once in full per account; the chart itself slices by
// range client-side rather than re-querying per range toggle.
export function usePortfolioValueHistory(account = 'All') {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Guards against out-of-order responses — see useDeposits.js for why this
  // matters (a slower, stale request for a different account can otherwise
  // resolve last and silently overwrite correct data).
  const latestRequestId = useRef(0)

  const fetchHistory = useCallback(async () => {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)

    const query =
      account === 'All'
        ? supabase.from('portfolio_value_history').select('snapshot_date, total_value').order('snapshot_date', { ascending: true })
        : supabase
            .from('account_value_history')
            .select('snapshot_date, total_value')
            .eq('account', account)
            .order('snapshot_date', { ascending: true })

    const { data, error: fetchError } = await query

    if (requestId !== latestRequestId.current) return

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setHistory(data ?? [])
    }
    setLoading(false)
  }, [account])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  return { history, loading, error, refetch: fetchHistory }
}
