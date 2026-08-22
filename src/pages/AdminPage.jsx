import { useAuth } from '../hooks/useAuth'
import AdminConfigPage from './AdminConfigPage'
import AdminSecretsPage from './AdminSecretsPage'
import AdminTradeTypesPage from './AdminTradeTypesPage'

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
            Business-logic constants used across the app — edited as form fields below, effective immediately.
          </p>
        </header>
        <AdminConfigPage />
      </section>
      <section className="page__section">
        <header className="page__header">
          <h2>Secrets</h2>
          <p className="page__subtitle">
            Twelve Data and Finnhub API keys — encrypted at rest, never shown again after saving.
          </p>
        </header>
        <AdminSecretsPage />
      </section>
      <section className="page__section">
        <header className="page__header">
          <h2>Trade Types</h2>
          <p className="page__subtitle">
            BUY, SELL, and Scheduled Buy are protected — add custom types (e.g. Dividend Reinvestment) below. A
            custom type can't be deleted while any trade still uses it.
          </p>
        </header>
        <AdminTradeTypesPage />
      </section>
    </div>
  )
}
