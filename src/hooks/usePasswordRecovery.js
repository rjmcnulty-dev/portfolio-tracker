import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// The password-reset email link lands back on the app with an auth token
// embedded in the URL hash. Supabase's SDK auto-detects it and fires
// PASSWORD_RECOVERY on the auth listener regardless of what our HashRouter
// makes of the resulting URL — the two hash-based mechanisms collide (see
// ResetPasswordPage's comment for the full explanation), so this is tracked
// independently of routing: App renders the reset form the instant this
// fires, with no route match required.
export function usePasswordRecovery() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setActive(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  return [active, setActive]
}
