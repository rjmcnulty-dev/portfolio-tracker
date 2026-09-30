import { createClient } from '@supabase/supabase-js'

const envUrl = import.meta.env.VITE_SUPABASE_URL
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isConfigured = Boolean(envUrl) && envUrl !== 'your_project_url' && Boolean(envAnonKey) && envAnonKey !== 'your_anon_key'

if (!isConfigured) {
  console.warn(
    'Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env — see README.md.',
  )
}

// Captured *before* createClient() below kicks off its own async
// URL-session detection, which clears window.location.hash once it's done
// reading it. GoTrue only gives 'recovery' links a dedicated
// PASSWORD_RECOVERY event (see usePasswordRecovery) — an invite link's hash
// carries `type=invite` but fires a plain SIGNED_IN, indistinguishable from
// a normal login unless something reads this hash first.
// consumeAuthRedirectType() lets that happen exactly once, so a captured
// 'invite' can't wrongly reapply to some later sign-in in the same tab.
let capturedAuthRedirectType =
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type')
export function consumeAuthRedirectType() {
  const value = capturedAuthRedirectType
  capturedAuthRedirectType = null
  return value
}

// Falls back to a syntactically valid placeholder URL so createClient doesn't
// throw before real credentials are provided; requests will simply fail until then.
export const supabase = createClient(
  isConfigured ? envUrl : 'https://placeholder.supabase.co',
  isConfigured ? envAnonKey : 'placeholder-anon-key',
)
