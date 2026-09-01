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

function persist(partial) {
  try {
    const current = loadSaved() ?? {}
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }))
  } catch {
    // Private browsing / storage disabled — selection still works for this
    // session, it just won't persist.
  }
}

// One shared setting across Dashboard and every account page (same
// STORAGE_KEY regardless of which page's AccountTabs instance is asking).
// Two independent things live here, saved differently on purpose:
//   - hiddenTabs: which cards are selected to appear as tabs at all.
//     A toggle, same as any other preference in this app (e.g. the
//     benchmark chart's hidden-tickers toggle) — persists immediately,
//     no separate save step.
//   - defaultActiveTab: which tab opens first on a future visit. Only
//     changes when setAsDefault() is explicitly called — clicking between
//     tabs during a session changes what's active *right now* without
//     touching this at all.
export function useAccountTabSelection(allTabKeys) {
  const [hiddenTabs, setHiddenTabs] = useState(() => {
    const saved = loadSaved()
    return new Set((saved?.hiddenTabs ?? []).filter((k) => allTabKeys.includes(k)))
  })

  const visibleTabs = useMemo(() => allTabKeys.filter((k) => !hiddenTabs.has(k)), [allTabKeys, hiddenTabs])

  const [activeTab, setActiveTabState] = useState(() => {
    const saved = loadSaved()
    const savedHidden = new Set(saved?.hiddenTabs ?? [])
    if (saved?.defaultActiveTab && allTabKeys.includes(saved.defaultActiveTab) && !savedHidden.has(saved.defaultActiveTab)) {
      return saved.defaultActiveTab
    }
    return allTabKeys.find((k) => !savedHidden.has(k)) ?? allTabKeys[0]
  })

  function setActiveTab(key) {
    if (visibleTabs.includes(key)) setActiveTabState(key)
  }

  function toggleTabHidden(key) {
    setHiddenTabs((prev) => {
      let next
      if (prev.has(key)) {
        next = new Set(prev)
        next.delete(key)
      } else {
        // At least one tab must stay visible/selectable.
        if (allTabKeys.length - prev.size <= 1) return prev
        next = new Set(prev)
        next.add(key)
        if (activeTab === key) {
          const fallback = allTabKeys.find((k) => k !== key && !next.has(k))
          if (fallback) setActiveTabState(fallback)
        }
      }
      persist({ hiddenTabs: [...next] })
      return next
    })
  }

  function setAsDefault() {
    persist({ defaultActiveTab: activeTab })
  }

  return { visibleTabs, activeTab, setActiveTab, toggleTabHidden, setAsDefault }
}
