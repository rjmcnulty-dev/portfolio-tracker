import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Single source of auth state for the app. Supabase persists the session to
// localStorage and auto-refreshes the token by default (supabase-js v2), so
// this just mirrors that state into React rather than managing it itself.
export function useAuth() {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return {
    user,
    // undefined = still resolving the initial session; null = signed out
    loading: user === undefined,
    signOut: () => supabase.auth.signOut(),
  }
}
