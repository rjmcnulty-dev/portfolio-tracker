import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'

// Nested inside RequireAuth (see App.jsx) — by the time this renders, `user`
// is guaranteed non-null. UX-only: the actual security boundary for the
// shared secrets this gates is the server-side check in the manage-secret
// Edge Function, since a client-side redirect can't stop a direct API call.
export default function RequireAdmin() {
  const { user } = useAuth()
  const { profile, loading } = useProfile(user?.id)

  if (loading) return null
  if (!profile?.is_admin) return <Navigate to="/" replace />
  return <Outlet />
}
