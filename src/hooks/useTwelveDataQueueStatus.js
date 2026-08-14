import { useEffect, useState } from 'react'
import { subscribeTwelveDataQueue } from '../lib/twelveDataQueue'

// Live status of the shared Twelve Data rate-limit queue (see
// src/lib/twelveDataQueue.js) — queued call count and when the current
// credit window resets, for a "Refreshing Data" indicator. Ticks its own
// forced re-render once a second while anything is queued, purely so a
// displayed "next batch in Ns" countdown stays live between the queue's own
// state-change notifications (which only fire on dispatch, not every second).
export function useTwelveDataQueueStatus() {
  const [status, setStatus] = useState({ queued: 0, windowCount: 0, windowEndsAt: 0 })
  const [, forceTick] = useState(0)

  useEffect(() => subscribeTwelveDataQueue(setStatus), [])

  useEffect(() => {
    if (!status.queued) return
    const interval = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [status.queued])

  return status
}
