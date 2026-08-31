import { useMemo, useState } from 'react'
import { useAccountTabSelection } from '../hooks/useAccountTabSelection'
import './AccountTabs.css'

// `tabs`: [{ key, label, render: () => ReactNode }]. Only the active tab's
// render() is ever called — the rest stay unmounted, not just visually
// hidden, so switching tabs doesn't mean every card's data hook fetches on
// page load regardless of what's actually being looked at.
export default function AccountTabs({ tabs }) {
  const allTabKeys = useMemo(() => tabs.map((t) => t.key), [tabs])
  const { visibleTabs, activeTab, setActiveTab, toggleTabHidden, setAsDefault } = useAccountTabSelection(allTabKeys)
  const [showCustomize, setShowCustomize] = useState(false)

  const activeTabDef = tabs.find((t) => t.key === activeTab)

  return (
    <div className="account-tabs">
      <div className="account-tabs__bar">
        <div className="account-tabs__buttons">
          {tabs
            .filter((t) => visibleTabs.includes(t.key))
            .map((t) => (
              <button
                key={t.key}
                type="button"
                className={`account-tabs__btn ${activeTab === t.key ? 'is-active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
        </div>

        <div className="account-tabs__customize">
          <button type="button" className="btn-link" onClick={() => setShowCustomize((v) => !v)}>
            Customize
          </button>
          {showCustomize && (
            <div className="account-tabs__panel">
              <p className="account-tabs__panel-title">Show tabs</p>
              {tabs.map((t) => (
                <label key={t.key} className="account-tabs__panel-item">
                  <input type="checkbox" checked={visibleTabs.includes(t.key)} onChange={() => toggleTabHidden(t.key)} />
                  {t.label}
                </label>
              ))}
              <button
                type="button"
                className="btn btn--primary account-tabs__set-default"
                onClick={() => {
                  setAsDefault()
                  setShowCustomize(false)
                }}
              >
                Set as Default
              </button>
              <p className="account-tabs__panel-hint">
                Shown/hidden tabs apply right away — Set as Default saves this setup (and the active tab) for next
                time, same across Dashboard and every account.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="account-tabs__content">{activeTabDef?.render()}</div>
    </div>
  )
}
