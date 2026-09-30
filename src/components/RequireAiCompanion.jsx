import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'

// Mirrors RequireAdmin.jsx exactly — same reasoning, different flag. Each
// call to AI Companion costs real Anthropic API money, so access is an
// explicit per-user grant (profiles.can_use_ai_companion, off by default for
// new accounts) rather than "anyone logged in." UX-only: the actual
// boundary is the server-side check in the ai-companion Edge Function
// itself, since a client-side redirect can't stop a direct API call.
export default function RequireAiCompanion() {
  const { user, loading: authLoading } = useAuth()
  const { profile, loading: profileLoading } = useProfile(user?.id)

  if (authLoading || profileLoading) return null
  if (!profile?.can_use_ai_companion) return <Navigate to="/" replace />
  return <Outlet />
}
