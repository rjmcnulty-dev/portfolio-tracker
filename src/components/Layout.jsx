import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { slugify } from '../lib/accounts'
import ManageAccountsForm from './ManageAccountsForm'

function linkClass({ isActive }) {
  return `sidebar__link ${isActive ? 'is-active' : ''}`
}

export default function Layout() {
  const { accounts, addAccount, deleteAccount, moveAccount, error: accountsError } = useAccounts()
  const [showManageAccounts, setShowManageAccounts] = useState(false)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">◆</span>
          <span className="sidebar__brand-name">Portfolio Tracker</span>
        </div>
        <nav className="sidebar__nav">
          <div className="sidebar__section-header">
            <p className="sidebar__section-label">Accounts</p>
            <button
              className="sidebar__manage-accounts"
              onClick={() => setShowManageAccounts(true)}
              title="Manage accounts"
            >
              Manage
            </button>
          </div>
          <NavLink to="/" end className={linkClass}>
            All Accounts
          </NavLink>
          {accountsError && <p className="sidebar__error">Accounts failed to load: {accountsError}</p>}
          {accounts.map((account) => (
            <NavLink key={account.id} to={`/account/${slugify(account.name)}`} className={linkClass}>
              {account.name}
            </NavLink>
          ))}
          <p className="sidebar__section-label">Tools</p>
          <NavLink to="/trades" className={linkClass}>
            Trade Log
          </NavLink>
          <NavLink to="/prices" className={linkClass}>
            Holdings - Prices
          </NavLink>
          <NavLink to="/deposits" className={linkClass}>
            Deposits and Withdrawals
          </NavLink>
          <NavLink to="/watch" className={linkClass}>
            Stock Watch
          </NavLink>
          <NavLink to="/tax" className={linkClass}>
            Tax &amp; Roth
          </NavLink>
          <NavLink to="/admin" className={linkClass}>
            Admin
          </NavLink>
        </nav>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>

      {showManageAccounts && (
        <ManageAccountsForm
          accounts={accounts}
          onClose={() => setShowManageAccounts(false)}
          onAdd={addAccount}
          onDelete={deleteAccount}
          onMove={moveAccount}
        />
      )}
    </div>
  )
}
