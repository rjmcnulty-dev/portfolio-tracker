// Global (module-level, shared across every useStockQuote instance) queue
// enforcing Twelve Data's free-tier 8-credits/minute cap across the whole
// app, not just one flow. Nothing about page mount, a manual range click,
// the per-card Refresh button, or the Stock Watch Sync modal is otherwise
// coordinated — each WatchlistCard's useStockQuote is an independent hook
// instance, so without a shared gate here, simply loading a page with more
// than 8 watchlist tickers fires that many uncoordinated fetches at once
// and blows the cap immediately.
let MAX_PER_WINDOW = 8
let WINDOW_MS = 61_000

// Called once from Layout.jsx (rendered for every route) after app_config
// loads — this module is a plain singleton, not a component/hook, so it
// can't read config itself. No-ops for any field left unset, so a
// still-loading or missing config row just keeps the defaults above.
export function configureTwelveDataQueue({ maxPerWindow, windowMs } = {}) {
  if (maxPerWindow) MAX_PER_WINDOW = maxPerWindow
  if (windowMs) WINDOW_MS = windowMs
}

let windowCount = 0
let windowEndsAt = 0
const queue = []
const listeners = new Set()

function getStatus() {
  return { queued: queue.length, windowCount, windowEndsAt }
}

function notify() {
  const status = getStatus()
  for (const listener of listeners) listener(status)
}

function processQueue() {
  const now = Date.now()
  if (now >= windowEndsAt) {
    windowCount = 0
    windowEndsAt = 0
  }

  while (queue.length && windowCount < MAX_PER_WINDOW) {
    if (!windowEndsAt) windowEndsAt = Date.now() + WINDOW_MS
    windowCount += 1
    const job = queue.shift()
    job()
  }

  notify()

  if (queue.length) {
    setTimeout(processQueue, Math.max(0, windowEndsAt - Date.now()) + 50)
  }
}

// Wraps a Twelve Data-backed call (via an Edge Function invoke) so it only
// actually runs once the shared credit budget allows it. Returns a promise
// that resolves/rejects with whatever `fn` resolves/rejects with.
export function enqueueTwelveDataCall(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => {
      fn().then(resolve, reject)
    })
    processQueue()
  })
}

export function subscribeTwelveDataQueue(listener) {
  listeners.add(listener)
  listener(getStatus())
  return () => listeners.delete(listener)
}

// In-flight/resolved requests cached by "ticker:range", at module scope —
// shared by every WatchlistCard instance, not one cache per card. This
// matters beyond just "don't refetch a range you've already viewed": Vite's
// Hot Module Reload (and React StrictMode) can recreate a card's component
// instance without the old one's pending request ever settling first. A
// per-instance cache can't dedupe across that — each recreation queued its
// own fresh request, and since nothing removed the abandoned ones, they
// piled up in the shared queue across every edit-triggered remount during
// development. A module-scoped cache means any number of instances (old,
// new, StrictMode's double-invoke, whatever) asking for the same
// (ticker, range) all share the exact same in-flight promise and the exact
// same single queued request.
const requestCache = new Map()

export function fetchWatchlistQuote(ticker, range, invoke) {
  const key = `${ticker}:${range}`
  let entry = requestCache.get(key)
  if (!entry) {
    entry = enqueueTwelveDataCall(invoke).catch((err) => {
      requestCache.delete(key)
      throw err
    })
    requestCache.set(key, entry)
  }
  return entry
}

// Drops every cached range for a ticker — used by the per-card Refresh
// button, since the underlying price data changed and a previously-viewed
// range's cached series is stale too, not just whichever range is on screen.
export function invalidateWatchlistQuote(ticker) {
  for (const key of [...requestCache.keys()]) {
    if (key.startsWith(`${ticker}:`)) requestCache.delete(key)
  }
}

// This module's own state is otherwise immune to Vite's Hot Module Reload —
// module-level `let`/`const` state survives a hot-swap of this file, only
// component instances get recreated. Clearing it on dispose means editing
// this file during development starts the queue/cache fresh instead of
// carrying over whatever was mid-flight from before the edit.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    queue.length = 0
    windowCount = 0
    windowEndsAt = 0
    requestCache.clear()
    listeners.clear()
  })
}
