import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// profiles has no insert/update policy for authenticated users (see the
// multi-user migration) — a row is only ever created by hand, alongside
// provisioning the Auth user, so this is read-only by design.
export function useProfile(userId) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setLoading(false)
      return
    }

    let ignore = false
    setLoading(true)
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (ignore) return
        if (fetchError) {
          // Surfaced so a real fetch failure (e.g. a stale PostgREST schema
          // cache right after this table was created) is distinguishable
          // from "genuinely not an admin" in the console, instead of both
          // silently landing on the same is_admin-false redirect.
          console.error('[useProfile] failed to load profile:', fetchError.message)
          setError(fetchError.message)
        } else {
          setError(null)
        }
        setProfile(data)
        setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [userId])

  return { profile, loading, error }
}
