import { useAuth } from '../hooks/useAuth'

export default function AdminPage() {
  const { user, signOut } = useAuth()

  return (
    <div className="page">
      <header className="page__header page__header--row">
        <div>
          <h1>Admin</h1>
          <p className="page__subtitle">Signed in as {user?.email}.</p>
        </div>
        <button className="btn btn--ghost" onClick={signOut}>
          Sign out
        </button>
      </header>
      <p className="page__hint">App settings and secrets management land here next.</p>
    </div>
  )
}
