import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { useConfigValue } from '../hooks/useAppConfig'
import { slugify } from '../lib/accounts'
import { configureTwelveDataQueue } from '../lib/twelveDataQueue'
import ManageAccountsForm from './ManageAccountsForm'
import ManageToolsOrderForm from './ManageToolsOrderForm'

function linkClass({ isActive }) {
  return `sidebar__link ${isActive ? 'is-active' : ''}`
}

const TOOL_LINKS = [
  { key: 'trades', to: '/trades', label: 'Trade Log' },
  { key: 'prices', to: '/prices', label: 'Holdings - Prices' },
  { key: 'deposits', to: '/deposits', label: 'Deposits and Withdrawals' },
  { key: 'watch', to: '/watch', label: 'Stock Watch' },
  { key: 'portfolio-stocks', to: '/portfolio-stocks', label: 'Portfolio Stocks' },
  { key: 'tax', to: '/tax', label: 'Tax & Roth' },
  { key: 'ai-companion', to: '/ai-companion', label: 'AI Companion' },
  { key: 'admin', to: '/admin', label: 'Admin' },
]
const DEFAULT_TOOL_ORDER = TOOL_LINKS.map((t) => t.key)
const TOOLS_ORDER_KEY = 'portfolio-tracker:tools-order'
const TOOLS_COLLAPSED_KEY = 'portfolio-tracker:tools-collapsed'

function loadToolOrder() {
  try {
    const stored = window.localStorage.getItem(TOOLS_ORDER_KEY)
    if (!stored) return DEFAULT_TOOL_ORDER
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return DEFAULT_TOOL_ORDER
    // Drop any keys that no longer exist (e.g. a removed tool), then append
    // any tool not yet in the stored order (e.g. one added after this was
    // last saved) at the end, so a new nav link never silently disappears.
    const kept = parsed.filter((key) => DEFAULT_TOOL_ORDER.includes(key))
    const missing = DEFAULT_TOOL_ORDER.filter((key) => !kept.includes(key))
    return [...kept, ...missing]
  } catch {
    return DEFAULT_TOOL_ORDER
  }
}

export default function Layout() {
  const { accounts, addAccount, deleteAccount, moveAccount, error: accountsError } = useAccounts()
  const [showManageAccounts, setShowManageAccounts] = useState(false)
  const [showManageTools, setShowManageTools] = useState(false)
  const [toolOrder, setToolOrder] = useState(loadToolOrder)
  const [toolsCollapsed, setToolsCollapsed] = useState(
    () => window.localStorage.getItem(TOOLS_COLLAPSED_KEY) === 'true',
  )

  useEffect(() => {
    window.localStorage.setItem(TOOLS_ORDER_KEY, JSON.stringify(toolOrder))
  }, [toolOrder])

  useEffect(() => {
    window.localStorage.setItem(TOOLS_COLLAPSED_KEY, String(toolsCollapsed))
  }, [toolsCollapsed])

  const orderedTools = toolOrder.map((key) => TOOL_LINKS.find((t) => t.key === key)).filter(Boolean)

  function handleMoveTool(key, direction) {
    setToolOrder((prev) => {
      const index = prev.indexOf(key)
      if (index === -1) return prev
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
      return next
    })
  }

  // Rendered for every route, so this is the one place that can apply
  // app_config's rate limit to the module-level twelveDataQueue singleton —
  // see configureTwelveDataQueue for why it can't just read config itself.
  const rateLimit = useConfigValue('twelve_data_rate_limit', null)
  useEffect(() => {
    if (rateLimit) configureTwelveDataQueue({ maxPerWindow: rateLimit.maxPerWindow, windowMs: rateLimit.windowMs })
  }, [rateLimit])

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
          <div className="sidebar__section-header">
            <button
              type="button"
              className="sidebar__section-toggle"
              onClick={() => setToolsCollapsed((v) => !v)}
              aria-expanded={!toolsCollapsed}
            >
              <span className={`sidebar__chevron ${toolsCollapsed ? 'is-collapsed' : ''}`}>▾</span>
              <span className="sidebar__section-label">Tools</span>
            </button>
            <button
              className="sidebar__manage-accounts"
              onClick={() => setShowManageTools(true)}
              title="Manage tools order"
            >
              Manage
            </button>
          </div>
          {!toolsCollapsed &&
            orderedTools.map((tool) => (
              <NavLink key={tool.key} to={tool.to} className={linkClass}>
                {tool.label}
              </NavLink>
            ))}
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
      {showManageTools && (
        <ManageToolsOrderForm
          tools={orderedTools}
          onClose={() => setShowManageTools(false)}
          onMove={handleMoveTool}
        />
      )}
    </div>
  )
}
