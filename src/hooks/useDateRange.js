import { useMemo, useState } from 'react'
import { useConfigValue } from './useAppConfig'

// Shared by BenchmarkComparisonChart and PortfolioValueChart on the same
// page — lifted up to AccountPage/Dashboard (each calls this once and
// passes the result to both charts) so picking a preset or a custom
// start/end date on either chart's RangeSelector moves both together,
// rather than each chart tracking its own independent range.
const DEFAULT_RANGES = [
  { key: 'daily', label: 'Daily', days: 30 },
  { key: 'monthly', label: 'Monthly', days: 365 },
  { key: 'yearly', label: 'Yearly', days: 1825 },
  { key: 'all', label: 'All Time', days: null },
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// `defaultCustomStart` ('YYYY-MM-DD', optional) opens the chart already
// pinned to a custom range starting there instead of the 'monthly' preset —
// used by AccountPage for an account whose default lookback would otherwise
// land before it existed (see ACCOUNT_DEFAULT_START_DATES there).
export function useDateRange(defaultKey = 'monthly', defaultCustomStart = null) {
  const RANGES = useConfigValue('portfolio_value_ranges', DEFAULT_RANGES)
  const [rangeKey, setRangeKey] = useState(defaultCustomStart ? 'custom' : defaultKey)
  const [customStart, setCustomStart] = useState(defaultCustomStart ?? '')
  const [customEnd, setCustomEnd] = useState('')

  const isCustom = rangeKey === 'custom'
  const preset = RANGES.find((r) => r.key === rangeKey)

  const { startDate, endDate } = useMemo(() => {
    if (isCustom) return { startDate: customStart || null, endDate: customEnd || todayStr() }
    if (!preset?.days) return { startDate: null, endDate: todayStr() }
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - preset.days)
    return { startDate: cutoff.toISOString().slice(0, 10), endDate: todayStr() }
  }, [isCustom, preset, customStart, customEnd])

  // Rough day-span, used only to pick x-axis tick-label granularity —
  // doesn't need to be exact for a custom range.
  const days = useMemo(() => {
    if (!isCustom) return preset?.days ?? null
    if (!startDate) return null
    return Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86_400_000)
  }, [isCustom, preset, startDate, endDate])

  function selectPreset(key) {
    setRangeKey(key)
    setCustomStart('')
    setCustomEnd('')
  }

  // Picking either date input switches the selection to 'custom' — the
  // preset buttons deactivate the moment a custom date is touched, rather
  // than needing a separate explicit "Custom" button.
  function selectCustomStart(value) {
    setCustomStart(value)
    setRangeKey('custom')
  }

  function selectCustomEnd(value) {
    setCustomEnd(value)
    setRangeKey('custom')
  }

  return {
    RANGES,
    rangeKey,
    isCustom,
    startDate,
    endDate,
    customStart,
    customEnd,
    days,
    selectPreset,
    selectCustomStart,
    selectCustomEnd,
  }
}
