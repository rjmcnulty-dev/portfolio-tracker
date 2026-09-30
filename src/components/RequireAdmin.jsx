import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'

// Nested inside RequireAuth (see App.jsx) — by the time this renders, `user`
// is guaranteed non-null. UX-only: the actual security boundary for the
// shared secrets this gates is the server-side check in the manage-secret
// Edge Function, since a client-side redirect can't stop a direct API call.
export default function RequireAdmin() {
  // useAuth() is called independently here (its own session-resolution
  // race, same as every other call site) — `user` can still be `undefined`
  // on this component's first render even though some other component
  // (e.g. Layout) already resolved it. useProfile(undefined) bails out
  // *synchronously* (loading: false, profile: null), so checking only
  // useProfile's loading let this redirect fire before auth had even
  // resolved the real user — the actual bug behind a real "can't reach
  // Admin" report. Must wait for both.
  const { user, loading: authLoading } = useAuth()
  const { profile, loading: profileLoading } = useProfile(user?.id)

  if (authLoading || profileLoading) return null
  if (!profile?.is_admin) return <Navigate to="/" replace />
  return <Outlet />
}
