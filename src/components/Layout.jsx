import { NavLink, Outlet } from 'react-router-dom'
import { ACCOUNTS } from '../lib/accounts'

function linkClass({ isActive }) {
  return `sidebar__link ${isActive ? 'is-active' : ''}`
}

export default function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">◆</span>
          <span className="sidebar__brand-name">Portfolio Tracker</span>
        </div>
        <nav className="sidebar__nav">
          <p className="sidebar__section-label">Accounts</p>
          <NavLink to="/" end className={linkClass}>
            All Accounts
          </NavLink>
          {ACCOUNTS.map((account) => (
            <NavLink key={account.slug} to={`/account/${account.slug}`} className={linkClass}>
              {account.label}
            </NavLink>
          ))}
          <p className="sidebar__section-label">Tools</p>
          <NavLink to="/trades" className={linkClass}>
            Trade Log
          </NavLink>
          <NavLink to="/prices" className={linkClass}>
            Prices
          </NavLink>
          <NavLink to="/tax" className={linkClass}>
            Tax &amp; Roth
          </NavLink>
        </nav>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
