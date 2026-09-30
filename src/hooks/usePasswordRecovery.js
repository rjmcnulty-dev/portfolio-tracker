import { useEffect, useState } from 'react'
import { supabase, consumeAuthRedirectType } from '../lib/supabase'

// The password-reset email link lands back on the app with an auth token
// embedded in the URL hash. Supabase's SDK auto-detects it and fires
// PASSWORD_RECOVERY on the auth listener regardless of what our HashRouter
// makes of the resulting URL — the two hash-based mechanisms collide (see
// ResetPasswordPage's comment for the full explanation), so this is tracked
// independently of routing: App renders the reset form the instant this
// fires, with no route match required.
//
// An invite link carries the exact same implicit-grant-tokens-in-the-hash
// shape, but GoTrue only special-cases `type=recovery` with PASSWORD_RECOVERY
// — an invite fires a plain SIGNED_IN, which would otherwise drop a brand
// new user straight into the app having never set a password of their own.
// consumeAuthRedirectType() recovers the hash's `type=invite` (captured in
// lib/supabase.js before GoTrue's own URL handling clears it) to catch that
// case too.
export function usePasswordRecovery() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setActive(true)
      else if (event === 'SIGNED_IN' && consumeAuthRedirectType() === 'invite') setActive(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  return [active, setActive]
}
