import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Called independently wherever config is needed — same "no React Context,
// redundant fetches are a non-issue" pattern as useAccounts (app_config is a
// handful of rows, publicly readable). Every consumer keeps its own current
// hardcoded value as a fallback default, so a slow/failed fetch never breaks
// the app — see useConfigValue below.
export function useAppConfig() {
  const [configByKey, setConfigByKey] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase.from('app_config').select('*')

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    setError(null)
    const map = {}
    for (const row of data ?? []) map[row.key] = row
    setConfigByKey(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const updateConfig = useCallback(
    async (key, value) => {
      const { error: updateError } = await supabase
        .from('app_config')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
      if (updateError) throw updateError
      await fetchConfig()
    },
    [fetchConfig],
  )

  return { configByKey, loading, error, updateConfig, refetch: fetchConfig }
}

// Convenience for the common case of reading a single key with a fallback —
// the fallback matches this call site's value before it became DB-backed, so
// behavior is unchanged until someone edits it from /admin.
export function useConfigValue(key, fallback) {
  const { configByKey, loading } = useAppConfig()
  const row = configByKey[key]
  return row ? row.value : fallback
}
