import { useState } from 'react'
import './ResetPasswordDialog.css'

// Mirrors ConfirmDialog's modal shell, but needs its own inputs (method
// choice, and the password fields for the "set directly" method) instead of
// a single confirm/cancel pair.
export default function ResetPasswordDialog({ email, onCancel, onSubmit }) {
  const [method, setMethod] = useState('email')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    if (method === 'direct') {
      if (password.length < 6) {
        setError('Password must be at least 6 characters.')
        return
      }
      if (password !== confirmPassword) {
        setError("Passwords don't match.")
        return
      }
    }

    setSubmitting(true)
    const result = await onSubmit({ method, password })
    setSubmitting(false)
    if (result?.error) setError(result.error)
  }

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        event.stopPropagation()
        onCancel()
      }}
    >
      <form className="modal reset-password-dialog" onClick={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
        <h2 className="modal__title">Reset password for {email}</h2>

        <label className="reset-password-dialog__field">
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="email">Send reset email</option>
            <option value="direct">Set password directly</option>
          </select>
        </label>

        {method === 'direct' && (
          <>
            <label className="reset-password-dialog__field">
              New Password
              <input
                type="password"
                required
                minLength={6}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </label>
            <label className="reset-password-dialog__field">
              Confirm Password
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          </>
        )}

        {error && <p className="reset-password-dialog__error">{error}</p>}

        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Working…' : method === 'email' ? 'Send Reset Email' : 'Set Password'}
          </button>
        </div>
      </form>
    </div>
  )
}
