import { useMemo, useState } from 'react'

const STORAGE_KEY = 'portfolio-tracker:account-tabs'

function loadSaved() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// One shared setting across Dashboard and every account page (same
// STORAGE_KEY regardless of which page's AccountTabs instance is asking) —
// hide/show which of the below-KPI cards appear as tabs, and which tab is
// active, both live for the current session immediately. Persisting either
// past a reload only happens on an explicit setAsDefault() call, so
// toggling a tab's visibility while exploring doesn't silently overwrite
// what loads next time.
export function useAccountTabSelection(allTabKeys) {
  const [hiddenTabs, setHiddenTabs] = useState(() => {
    const saved = loadSaved()
    return new Set((saved?.hiddenTabs ?? []).filter((k) => allTabKeys.includes(k)))
  })

  const [activeTab, setActiveTabState] = useState(() => {
    const saved = loadSaved()
    const savedHidden = new Set(saved?.hiddenTabs ?? [])
    if (saved?.activeTab && allTabKeys.includes(saved.activeTab) && !savedHidden.has(saved.activeTab)) {
      return saved.activeTab
    }
    return allTabKeys.find((k) => !savedHidden.has(k)) ?? allTabKeys[0]
  })

  const visibleTabs = useMemo(() => allTabKeys.filter((k) => !hiddenTabs.has(k)), [allTabKeys, hiddenTabs])

  function setActiveTab(key) {
    if (visibleTabs.includes(key)) setActiveTabState(key)
  }

  function toggleTabHidden(key) {
    setHiddenTabs((prev) => {
      if (prev.has(key)) {
        const next = new Set(prev)
        next.delete(key)
        return next
      }
      // At least one tab must stay visible/selectable.
      if (allTabKeys.length - prev.size <= 1) return prev
      const next = new Set(prev)
      next.add(key)
      if (activeTab === key) {
        const fallback = allTabKeys.find((k) => k !== key && !next.has(k))
        if (fallback) setActiveTabState(fallback)
      }
      return next
    })
  }

  function setAsDefault() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hiddenTabs: [...hiddenTabs], activeTab }))
    } catch {
      // Private browsing / storage disabled — customization still works for
      // this session, it just won't persist as the default.
    }
  }

  return { visibleTabs, activeTab, setActiveTab, hiddenTabs, toggleTabHidden, setAsDefault }
}
