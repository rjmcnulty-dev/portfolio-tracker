import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  ArrowLeftRight,
  Bot,
  ClipboardList,
  DollarSign,
  Eye,
  PieChart,
  Percent,
  Settings,
  Wallet,
} from 'lucide-react'
import { useAccounts } from '../hooks/useAccounts'
import { useConfigValue } from '../hooks/useAppConfig'
import { slugify } from '../lib/accounts'
import { configureTwelveDataQueue } from '../lib/twelveDataQueue'
import ManageAccountsForm from './ManageAccountsForm'
import ManageToolsOrderForm from './ManageToolsOrderForm'

function linkClass({ isActive }) {
  return `sidebar__link ${isActive ? 'is-active' : ''}`
}

function iconLinkClass({ isActive }) {
  return `sidebar__icon-link ${isActive ? 'is-active' : ''}`
}

const SKIP_WORDS = new Set(['and', '&', '-', '/'])

// Account names are arbitrary user text, not a fixed set a real icon could
// be curated for the way TOOL_LINKS' icons below are — a 2-letter monogram
// works for any name with no per-account icon-picking needed. Collisions
// (two accounts landing on the same initials) are fine; the full name is
// still available via each link's title tooltip.
function getInitials(label) {
  const words = label.split(/[\s/&-]+/).filter((w) => w && !SKIP_WORDS.has(w.toLowerCase()))
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}

const TOOL_LINKS = [
  { key: 'trades', to: '/trades', label: 'Trade Log', icon: ClipboardList },
  { key: 'prices', to: '/prices', label: 'Holdings - Prices', icon: DollarSign },
  { key: 'deposits', to: '/deposits', label: 'Deposits and Withdrawals', icon: ArrowLeftRight },
  { key: 'watch', to: '/watch', label: 'Stock Watch', icon: Eye },
  { key: 'portfolio-stocks', to: '/portfolio-stocks', label: 'Portfolio Stocks', icon: PieChart },
  { key: 'tax', to: '/tax', label: 'Tax & Roth', icon: Percent },
  { key: 'ai-companion', to: '/ai-companion', label: 'AI Companion', icon: Bot },
  { key: 'admin', to: '/admin', label: 'Admin', icon: Settings },
]
const DEFAULT_TOOL_ORDER = TOOL_LINKS.map((t) => t.key)
const TOOLS_ORDER_KEY = 'portfolio-tracker:tools-order'
const TOOLS_COLLAPSED_KEY = 'portfolio-tracker:tools-collapsed'
const SIDEBAR_COLLAPSED_KEY = 'portfolio-tracker:sidebar-collapsed'

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true',
  )

  useEffect(() => {
    window.localStorage.setItem(TOOLS_ORDER_KEY, JSON.stringify(toolOrder))
  }, [toolOrder])

  useEffect(() => {
    window.localStorage.setItem(TOOLS_COLLAPSED_KEY, String(toolsCollapsed))
  }, [toolsCollapsed])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

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
      <aside className={`sidebar ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}>
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">◆</span>
          {!sidebarCollapsed && <span className="sidebar__brand-name">Portfolio Tracker</span>}
          <button
            type="button"
            className="sidebar__collapse-toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        {sidebarCollapsed ? (
          <nav className="sidebar__nav sidebar__nav--collapsed">
            <NavLink to="/" end className={iconLinkClass} title="All Accounts">
              <Wallet size={18} strokeWidth={2} />
            </NavLink>
            {accounts.map((account) => (
              <NavLink
                key={account.id}
                to={`/account/${slugify(account.name)}`}
                className={iconLinkClass}
                title={account.name}
              >
                {getInitials(account.name)}
              </NavLink>
            ))}
            <div className="sidebar__collapsed-divider" />
            {orderedTools.map((tool) => (
              <NavLink key={tool.key} to={tool.to} className={iconLinkClass} title={tool.label}>
                <tool.icon size={18} strokeWidth={2} />
              </NavLink>
            ))}
          </nav>
        ) : (
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
              <Wallet size={16} strokeWidth={2} />
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
                  <tool.icon size={16} strokeWidth={2} />
                  {tool.label}
                </NavLink>
              ))}
          </nav>
        )}
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
