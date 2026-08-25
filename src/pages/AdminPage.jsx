import { useAuth } from '../hooks/useAuth'
import AdminConfigPage from './AdminConfigPage'
import AdminSecretsPage from './AdminSecretsPage'
import AdminTradeTypesPage from './AdminTradeTypesPage'
import AdminBenchmarksPage from './AdminBenchmarksPage'

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
      <section className="page__section">
        <header className="page__header">
          <h2>Benchmarks</h2>
          <p className="page__subtitle">
            Market indexes/ETFs shown on the Portfolio Performance chart — add, edit, or remove which ones are
            available. After adding one, run <code>npm run benchmarks:backfill</code> to pull in its full price
            history (it accumulates going forward automatically either way).
          </p>
        </header>
        <AdminBenchmarksPage />
      </section>
    </div>
  )
}
