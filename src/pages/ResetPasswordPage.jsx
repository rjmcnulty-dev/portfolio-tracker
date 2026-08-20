import { useState } from 'react'
import { supabase } from '../lib/supabase'
import './LoginPage.css'

// Rendered by App in place of the normal routes whenever usePasswordRecovery
// fires — see that hook for why this doesn't live behind a matched route.
// updateUser works here because the recovery link's token already
// established a (temporary, recovery-scoped) session before this renders.
export default function ResetPasswordPage({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setSubmitting(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="login-page">
        <div className="login-page__card">
          <h1 className="login-page__title">Password updated</h1>
          <p className="login-page__subtitle">You're signed in with your new password.</p>
          <button type="button" className="btn btn--primary" onClick={onDone}>
            Continue to Admin
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <form className="login-page__card" onSubmit={handleSubmit}>
        <h1 className="login-page__title">Set a new password</h1>
        <p className="login-page__subtitle">Choose a new password for your admin account.</p>
        <label>
          New Password
          <input
            type="password"
            required
            autoFocus
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm Password
          <input
            type="password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {error && <p className="login-page__error">{error}</p>}
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  )
}
