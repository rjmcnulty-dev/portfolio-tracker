import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// profiles has no insert/update policy for authenticated users (see the
// multi-user migration) — a row is only ever created by hand, alongside
// provisioning the Auth user, so this is read-only by design.
export function useProfile(userId) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
      .then(({ data }) => {
        if (ignore) return
        setProfile(data)
        setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [userId])

  return { profile, loading }
}
