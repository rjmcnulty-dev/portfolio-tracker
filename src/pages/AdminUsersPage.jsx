import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import ConfirmDialog from '../components/ConfirmDialog'
import './AdminUsersPage.css'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState(null)

  const [email, setEmail] = useState('')
  const [method, setMethod] = useState('invite')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedMessage, setSavedMessage] = useState(null)

  const [resendingId, setResendingId] = useState(null)
  const [resendResultById, setResendResultById] = useState({})

  const [togglingId, setTogglingId] = useState(null)
  const [rowErrorById, setRowErrorById] = useState({})
  const [confirmingDelete, setConfirmingDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data, error: invokeError } = await supabase.functions.invoke('manage-users', {
      body: { action: 'list' },
    })
    if (invokeError) setListError(invokeError.message)
    else if (data?.error) setListError(data.error)
    else {
      setListError(null)
      setUsers(data.users ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  async function handleAdd(event) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return

    setSaving(true)
    setSaveError(null)
    setSavedMessage(null)

    // Bare origin+pathname, no hash — same reasoning as LoginPage's password
    // reset redirectTo: Supabase appends the invite token as its own URL
    // hash, which would collide with a route already living in our
    // HashRouter's hash. usePasswordRecovery picks up the resulting session
    // via Supabase's own auth event instead of relying on that URL to match
    // a route.
    const redirectTo = `${window.location.origin}${window.location.pathname}`
    const { data, error: invokeError } = await supabase.functions.invoke('manage-users', {
      body: { action: method, email: trimmed, password, isAdmin, redirectTo },
    })

    setSaving(false)
    if (invokeError) {
      setSaveError(invokeError.message)
      return
    }
    if (data?.error) {
      setSaveError(data.error)
      return
    }

    setSavedMessage(
      method === 'invite' ? `Invited ${data.user.email} — they'll get an email to set their password.` : `Created ${data.user.email}.`,
    )
    setEmail('')
    setPassword('')
    setIsAdmin(false)
    await fetchUsers()
  }

  async function handleResendInvite(u) {
    setResendingId(u.id)
    setResendResultById((prev) => ({ ...prev, [u.id]: null }))

    // Same bare-URL reasoning as handleAdd above.
    const redirectTo = `${window.location.origin}${window.location.pathname}`
    const { data, error: invokeError } = await supabase.functions.invoke('manage-users', {
      body: { action: 'resendInvite', email: u.email, redirectTo },
    })

    setResendingId(null)
    if (invokeError) {
      setResendResultById((prev) => ({ ...prev, [u.id]: { error: invokeError.message } }))
      return
    }
    if (data?.error) {
      setResendResultById((prev) => ({ ...prev, [u.id]: { error: data.error } }))
      return
    }
    setResendResultById((prev) => ({ ...prev, [u.id]: { ok: true } }))
  }

  async function handleToggleActive(u) {
    setTogglingId(u.id)
    setRowErrorById((prev) => ({ ...prev, [u.id]: null }))

    const { data, error: invokeError } = await supabase.functions.invoke('manage-users', {
      body: { action: 'setActive', userId: u.id, active: !u.active },
    })

    setTogglingId(null)
    if (invokeError) {
      setRowErrorById((prev) => ({ ...prev, [u.id]: invokeError.message }))
      return
    }
    if (data?.error) {
      setRowErrorById((prev) => ({ ...prev, [u.id]: data.error }))
      return
    }
    await fetchUsers()
  }

  async function handleConfirmDelete() {
    const target = confirmingDelete
    setConfirmingDelete(null)
    setDeletingId(target.id)
    setRowErrorById((prev) => ({ ...prev, [target.id]: null }))

    const { data, error: invokeError } = await supabase.functions.invoke('manage-users', {
      body: { action: 'delete', userId: target.id },
    })

    setDeletingId(null)
    if (invokeError) {
      setRowErrorById((prev) => ({ ...prev, [target.id]: invokeError.message }))
      return
    }
    if (data?.error) {
      setRowErrorById((prev) => ({ ...prev, [target.id]: data.error }))
      return
    }
    await fetchUsers()
  }

  return (
    <div className="admin-users">
      <p className="page__hint">
        New logins are admin-provisioned only — there's no self-serve sign-up page. Creating a user here also sets
        up their <code>profiles</code> row, so they don't end up in a half-provisioned state the way creating one
        straight from the Supabase Dashboard would.
      </p>

      {loading ? (
        <p className="page__loading">Loading users…</p>
      ) : listError ? (
        <p className="page__error">Error: {listError}</p>
      ) : (
        <table className="admin-users__table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Admin</th>
              <th>Active</th>
              <th>Created</th>
              <th>Last Sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const resendResult = resendResultById[u.id]
              const rowError = rowErrorById[u.id]
              const isSelf = u.id === currentUser?.id
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.isAdmin ? 'Yes' : '—'}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.active}
                      disabled={isSelf || togglingId === u.id}
                      title={isSelf ? "You can't deactivate the account you're signed in as" : undefined}
                      onChange={() => handleToggleActive(u)}
                    />
                  </td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>{formatDate(u.lastSignInAt)}</td>
                  <td className="admin-users__row-actions">
                    {!u.lastSignInAt && (
                      <>
                        <button
                          type="button"
                          className="btn-link"
                          disabled={resendingId === u.id}
                          onClick={() => handleResendInvite(u)}
                        >
                          {resendingId === u.id ? 'Sending…' : 'Resend Invite'}
                        </button>
                        {resendResult?.ok && <span className="admin-users__saved">Sent</span>}
                        {resendResult?.error && <span className="admin-users__error">{resendResult.error}</span>}
                      </>
                    )}
                    {!isSelf && (
                      <button
                        type="button"
                        className="btn-link btn-link--danger"
                        disabled={deletingId === u.id}
                        onClick={() => setConfirmingDelete(u)}
                      >
                        {deletingId === u.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                    {rowError && <span className="admin-users__error">{rowError}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <form className="admin-users__add-form" onSubmit={handleAdd}>
        <label>
          Email
          <input
            type="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="invite">Send invite email</option>
            <option value="create">Set password directly</option>
          </select>
        </label>

        {method === 'create' && (
          <label>
            Password
            <input
              type="password"
              required
              minLength={6}
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}

        <label className="admin-users__admin-label">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Make admin
        </label>

        {saveError && <p className="admin-users__error">{saveError}</p>}
        {savedMessage && !saveError && <p className="admin-users__saved">{savedMessage}</p>}

        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Adding…' : method === 'invite' ? 'Send Invite' : '+ Add User'}
        </button>
      </form>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete user?"
          message={`Permanently delete ${confirmingDelete.email}? This can't be undone. If they still have any accounts, trades, or other data attached, the delete will be blocked until that's removed.`}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  )
}
