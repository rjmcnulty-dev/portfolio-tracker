import { useAuth } from '../hooks/useAuth'
import AdminConfigPage from './AdminConfigPage'

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
      <section className="page__section">
        <header className="page__header">
          <h2>App Settings</h2>
          <p className="page__subtitle">
            Business-logic constants used across the app — edited here as raw JSON, effective immediately.
          </p>
        </header>
        <AdminConfigPage />
      </section>
    </div>
  )
}
