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
  const [justSaved, setJustSaved] = useState(false)

  const activeTabDef = tabs.find((t) => t.key === activeTab)

  function handleSetAsDefault() {
    setAsDefault()
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }

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

        <div className="account-tabs__actions">
          <button type="button" className="btn-link" onClick={handleSetAsDefault}>
            {justSaved ? 'Saved!' : 'Set as Default'}
          </button>

          <div className="account-tabs__customize">
            <button type="button" className="btn-link" onClick={() => setShowCustomize((v) => !v)}>
              Customize
            </button>
            {showCustomize && (
              <div className="account-tabs__panel">
                <p className="account-tabs__panel-title">Select cards</p>
                {tabs.map((t) => (
                  <label key={t.key} className="account-tabs__panel-item">
                    <input type="checkbox" checked={visibleTabs.includes(t.key)} onChange={() => toggleTabHidden(t.key)} />
                    {t.label}
                  </label>
                ))}
                <p className="account-tabs__panel-hint">
                  Applies right away, same across Dashboard and every account. Use "Set as Default" (next to
                  Customize) to also pin whichever tab is active now as the one that opens first next time.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="account-tabs__content">{activeTabDef?.render()}</div>
    </div>
  )
}
