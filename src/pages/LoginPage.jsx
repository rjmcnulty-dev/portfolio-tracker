import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useConfigValue } from '../hooks/useAppConfig'
import './LoginPage.css'

export default function LoginPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Public/unauthenticated read, same as every other app_config row — see
  // README's "Password reset" section for the security note on what
  // belongs (and doesn't) in this field.
  const loginHint = useConfigValue('login_hint', '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const [mode, setMode] = useState('signin')
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [resetError, setResetError] = useState(null)
  const [resetSent, setResetSent] = useState(false)

  const redirectTo = location.state?.from ?? '/admin'

  if (!authLoading && user) {
    navigate(redirectTo, { replace: true })
    return null
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    setSubmitting(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    navigate(redirectTo, { replace: true })
  }

  // redirectTo is the bare app URL (no hash route) on purpose — Supabase
  // appends the recovery token as its own URL hash, which would collide
  // with a HashRouter route already living in the hash. usePasswordRecovery
  // picks up the resulting session via Supabase's own auth event instead of
  // relying on that mangled URL to match a route. See its comment for
  // the full explanation, and README's "Password reset" section for the
  // one-time Supabase dashboard setup this requires (allow-listing this
  // redirect URL).
  async function handleForgotPassword(event) {
    event.preventDefault()
    setResetSubmitting(true)
    setResetError(null)

    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    })

    setResetSubmitting(false)
    if (resetErr) {
      setResetError(resetErr.message)
      return
    }
    setResetSent(true)
  }

  if (mode === 'forgot') {
    return (
      <div className="login-page">
        <form className="login-page__card" onSubmit={handleForgotPassword}>
          <h1 className="login-page__title">Reset password</h1>
          <p className="login-page__subtitle">
            {resetSent
              ? "If that email has an account, we've sent a reset link — check your inbox."
              : "Enter your account's email and we'll send a reset link."}
          </p>
          {!resetSent && (
            <label>
              Email
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {resetError && <p className="login-page__error">{resetError}</p>}
          {!resetSent && (
            <button type="submit" className="btn btn--primary" disabled={resetSubmitting}>
              {resetSubmitting ? 'Sending…' : 'Send Reset Link'}
            </button>
          )}
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setMode('signin')
              setResetSent(false)
              setResetError(null)
            }}
          >
            Back to sign in
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="login-page">
      <form className="login-page__card" onSubmit={handleSubmit}>
        <h1 className="login-page__title">Sign in</h1>
        <p className="login-page__subtitle">Admin access to Portfolio Tracker.</p>
        <label>
          Email
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="login-page__error">{error}</p>}
        {loginHint && <p className="login-page__hint">Hint: {loginHint}</p>}
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="btn-link" onClick={() => setMode('forgot')}>
          Forgot password?
        </button>
      </form>
    </div>
  )
}
