import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { slugify } from '../lib/accounts'
import AddAccountForm from './AddAccountForm'

function linkClass({ isActive }) {
  return `sidebar__link ${isActive ? 'is-active' : ''}`
}

export default function Layout() {
  const { accounts, addAccount } = useAccounts()
  const [showAddAccount, setShowAddAccount] = useState(false)

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
              className="sidebar__add-account"
              onClick={() => setShowAddAccount(true)}
              title="Add account"
            >
              +
            </button>
          </div>
          <NavLink to="/" end className={linkClass}>
            All Accounts
          </NavLink>
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
            Prices
          </NavLink>
          <NavLink to="/deposits" className={linkClass}>
            Deposits
          </NavLink>
          <NavLink to="/watch" className={linkClass}>
            Stock Watch
          </NavLink>
          <NavLink to="/tax" className={linkClass}>
            Tax &amp; Roth
          </NavLink>
        </nav>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>

      {showAddAccount && (
        <AddAccountForm onClose={() => setShowAddAccount(false)} onAdd={addAccount} />
      )}
    </div>
  )
}
