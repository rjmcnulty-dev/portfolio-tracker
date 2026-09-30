import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// profiles has no insert/update policy for authenticated users (see the
// multi-user migration) — a row is only ever created by hand, alongside
// provisioning the Auth user, so this is read-only by design.
export function useProfile(userId) {
  // Tracks which userId the held profile/error actually correspond to,
  // alongside the values themselves — not just profile/loading/error as
  // separate pieces of state. That's what lets the staleness check below
  // work: comparing this state's own `userId` against the current argument
  // catches the one-render gap between a caller's userId prop changing
  // (e.g. useAuth's `user` resolving) and this hook's effect reacting to it
  // (effects run after render, not during) — RequireAdmin hit exactly this
  // race, reading loading:false with the previous (often undefined) userId's
  // leftover null profile for one render before the real fetch had even
  // started, which was enough to fire its redirect a render early.
  const [state, setState] = useState({ userId: undefined, profile: null, loading: true, error: null })

  useEffect(() => {
    if (!userId) {
      setState({ userId, profile: null, loading: false, error: null })
      return
    }

    let ignore = false
    setState((prev) => ({ ...prev, userId, loading: true }))
    supabase
      .from('profiles')
      .select('is_admin, can_use_ai_companion')
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
        }
        setState({ userId, profile: data, loading: false, error: fetchError?.message ?? null })
      })

    return () => {
      ignore = true
    }
  }, [userId])

  const isStale = state.userId !== userId
  return {
    profile: isStale ? null : state.profile,
    loading: isStale || state.loading,
    error: isStale ? null : state.error,
  }
}
