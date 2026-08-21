import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_USAGE, sumUsage } from '../lib/aiUsagePricing'

// All-time usage, summed client-side from every row ai-companion has ever
// logged. Fetches (not aggregates in SQL) since a personal single-user
// app's row count stays small for years of daily use — simpler and more
// portable than relying on PostgREST aggregate support.
export function useAiUsageTotal() {
  const [usage, setUsage] = useState(EMPTY_USAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('ai_usage_log')
        .select('input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, web_search_requests')
      if (ignore) return

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }
      setError(null)
      setUsage((data ?? []).reduce(sumUsage, EMPTY_USAGE))
      setLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  return { usage, loading, error }
}
