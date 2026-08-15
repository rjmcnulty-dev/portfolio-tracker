import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Account's total_value (cash + holdings, from account_value_history — the
// same source PortfolioValueChart uses) at the boundaries of a date range.
// "Start" is the latest row strictly before rangeStart — the account's
// value going into the period, matching how the Daily Gains table's own
// first-column change is computed relative to the day before it starts.
// "End" is the latest row on or before rangeEnd. Either can come back null
// if that day was skipped during backfill (e.g. a held ticker had no price
// data yet) — shown as "Not available" rather than a misleading $0.
export function useAccountValueBounds(account, rangeStart, rangeEnd) {
  const [startValue, setStartValue] = useState(null)
  const [endValue, setEndValue] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!account || !rangeStart || !rangeEnd) {
      setStartValue(null)
      setEndValue(null)
      setLoading(false)
      return
    }

    let ignore = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data, error: fetchError } = await supabase
        .from('account_value_history')
        .select('snapshot_date, total_value')
        .eq('account', account)
        .lte('snapshot_date', rangeEnd)
        .order('snapshot_date', { ascending: false })

      if (ignore) return

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      const rows = data ?? []
      const endRow = rows[0] ?? null
      const startRow = rows.find((row) => row.snapshot_date < rangeStart) ?? null
      setEndValue(endRow ? Number(endRow.total_value) : null)
      setStartValue(startRow ? Number(startRow.total_value) : null)
      setLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
  }, [account, rangeStart, rangeEnd])

  return { startValue, endValue, loading, error }
}
