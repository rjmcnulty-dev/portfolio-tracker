import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'

// Nested inside RequireAuth (see App.jsx) — by the time this renders, `user`
// is guaranteed non-null. UX-only: the actual security boundary for the
// shared secrets this gates is the server-side check in the manage-secret
// Edge Function, since a client-side redirect can't stop a direct API call.
export default function RequireAdmin() {
  const { user } = useAuth()
  const { profile, loading, error } = useProfile(user?.id)

  if (loading) return null
  if (!profile?.is_admin) {
    // TEMPORARY diagnostic — a "can't reach Admin" report wasn't explained by
    // the DB/RLS (verified directly, working) or a stale bundle (verified
    // deployed), so this makes the actual client-side state visible on
    // screen instead of guessing further. Remove once the real cause is found.
    return (
      <pre style={{ padding: 24, fontSize: 13, whiteSpace: 'pre-wrap' }}>
        RequireAdmin debug — not redirecting silently this time.{'\n'}
        {JSON.stringify({ userId: user?.id, loading, profile, error }, null, 2)}
      </pre>
    )
  }
  return <Outlet />
}
