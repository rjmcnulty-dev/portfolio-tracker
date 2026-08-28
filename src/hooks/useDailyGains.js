import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isBuyTrade } from '../lib/tradeTypes'
import { useConfigValue } from './useAppConfig'

const DEFAULT_DAILY_GAINS_DEFAULTS = { defaultDayCount: 5, weekSize: 5 }

// Generous lookback for the price-history fetch below — covers the default
// view, every Week-dropdown option, and most custom ranges without ever
// approaching PostgREST's 1000-row default cap on an unbounded query. That
// cap used to be a non-issue here since ticker_price_history stayed small,
// but a ticker held here that's *also* a benchmark (see BenchmarkComparisonChart)
// can now carry years of backfilled history — an unbounded ascending query
// across several held tickers would silently return only the oldest rows
// (that ticker's ancient history) and drop every recent price for
// everything, held ticker included.
const LOOKBACK_DAYS = 400
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// Day-by-day $ / % change per ticker, as a matrix: one row per ticker, one
// column per trading day. `range` is either null (default: the 5 most
// recent trading days with data) or `{ start, end }` (inclusive 'YYYY-MM-DD'
// strings from the date-range picker).
//
// Each day's dollar change is (that day's price − prior priced day's price)
// × the quantity held *before that day's own trades* — not today's current
// quantity applied uniformly across every column. Shares bought partway
// through the shown range didn't exist yet on earlier days (their cost
// basis is that day's price, not an earlier day's — no price-driven gain to
// attribute), and shares sold partway through stop contributing after the
// sale. `trades` (the account's raw trade list) is what makes this
// possible; `holdings` only has today's already-netted quantity, which is
// exactly the number that's wrong for anything but the most recent column.
//
// Columns come from the union of dates that actually have price history
// across the held tickers (not a fixed calendar walk), so weekends/
// holidays/gaps don't produce empty columns.
//
// ticker_price_history is written once a day, so a ticker bought before
// that day's snapshot exists has nothing to diff against on the day right
// after purchase — see buyPriceByTickerDate below, which fills that specific
// gap with the trade's own execution price so recently-bought tickers don't
// silently understate/overstate their total.
export function useDailyGains(holdings, trades, range) {
  const { defaultDayCount } = useConfigValue('daily_gains_defaults', DEFAULT_DAILY_GAINS_DEFAULTS)
  const [historyByTicker, setHistoryByTicker] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const tickers = useMemo(() => holdings.map((h) => h.ticker).sort(), [holdings])
  const tickersKey = tickers.join(',')

  // Extends back far enough to cover an explicit custom range that reaches
  // further than the default lookback (e.g. an account held since before
  // that window) — otherwise just the flat default.
  const fromDate = useMemo(() => {
    const cutoff = new Date(`${todayStr()}T00:00:00Z`)
    cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS)
    const defaultFrom = cutoff.toISOString().slice(0, 10)
    return range?.start && range.start < defaultFrom ? range.start : defaultFrom
  }, [range])

  useEffect(() => {
    if (!tickers.length) {
      setHistoryByTicker({})
      setLoading(false)
      return
    }

    let ignore = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data, error: fetchError } = await supabase
        .from('ticker_price_history')
        .select('ticker, as_of, price')
        .in('ticker', tickers)
        .gte('as_of', fromDate)
        .order('as_of', { ascending: true })

      if (ignore) return

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      const byTicker = {}
      for (const row of data ?? []) {
        if (!byTicker[row.ticker]) byTicker[row.ticker] = []
        byTicker[row.ticker].push({ as_of: row.as_of, price: Number(row.price) })
      }
      setHistoryByTicker(byTicker)
      setLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey, fromDate])

  // Per-ticker, chronologically sorted (date, signed quantity delta) events
  // — used to replay "how many shares were held before this date's own
  // trades" for any date, not just today.
  const tradeEventsByTicker = useMemo(() => {
    const byTicker = {}
    for (const trade of trades) {
      const qty = Number(trade.quantity) || 0
      const signed = isBuyTrade(trade.trade_type) ? qty : trade.trade_type === 'SELL' ? -qty : 0
      if (!signed) continue
      if (!byTicker[trade.ticker]) byTicker[trade.ticker] = []
      byTicker[trade.ticker].push({ date: trade.trade_date, signedQty: signed })
    }
    for (const events of Object.values(byTicker)) {
      events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    }
    return byTicker
  }, [trades])

  function quantityBefore(ticker, date) {
    const events = tradeEventsByTicker[ticker] ?? []
    let qty = 0
    for (const event of events) {
      if (event.date >= date) break
      qty += event.signedQty
    }
    return qty
  }

  // Per ticker/date, the combined size and cost of that day's buy lots
  // (quantity-weighted, so multiple same-day lots collapse into one
  // accurate figure rather than picking one arbitrarily) — used two ways
  // below: as a synthetic price point on dates with no real
  // ticker_price_history row, and to credit new shares with their gain
  // since purchase on the day they were actually bought (see changesByTicker).
  const buyTotalsByTickerDate = useMemo(() => {
    const totals = new Map()
    for (const trade of trades) {
      if (!isBuyTrade(trade.trade_type)) continue
      const qty = Number(trade.quantity) || 0
      const price = Number(trade.price) || 0
      if (!qty || !price) continue
      if (!totals.has(trade.ticker)) totals.set(trade.ticker, new Map())
      const byDate = totals.get(trade.ticker)
      const entry = byDate.get(trade.trade_date) ?? { totalQty: 0, totalCost: 0 }
      entry.totalQty += qty
      entry.totalCost += qty * price
      byDate.set(trade.trade_date, entry)
    }
    return totals
  }, [trades])

  const changesByTicker = useMemo(() => {
    const result = {}
    for (const holding of holdings) {
      const realHistory = historyByTicker[holding.ticker] ?? []
      const existingDates = new Set(realHistory.map((h) => h.as_of))
      const buyTotals = buyTotalsByTickerDate.get(holding.ticker)
      // ticker_price_history is written once a day, but a trade can happen
      // any time — a ticker bought on a day with no snapshot yet has no
      // price point to diff against until the next real one, so the
      // movement between what was actually paid and that next snapshot
      // would otherwise fall into an unrepresented gap.
      const synthetic = []
      if (buyTotals) {
        for (const [date, { totalQty, totalCost }] of buyTotals) {
          if (!existingDates.has(date)) synthetic.push({ as_of: date, price: totalCost / totalQty })
        }
      }
      const history = [...realHistory, ...synthetic].sort((a, b) =>
        a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : 0,
      )
      const changes = []
      for (let i = 0; i < history.length; i++) {
        const date = history[i].as_of
        const currPrice = history[i].price
        let dollarChange = 0
        let priorValue = 0

        // Existing shares' movement since the prior priced day — quantityBefore
        // deliberately excludes trades dated `date` itself, since those shares
        // weren't held at prevPrice and shouldn't inherit its movement.
        if (i > 0) {
          const prevPrice = history[i - 1].price
          const quantityHeld = quantityBefore(holding.ticker, date)
          dollarChange += (currPrice - prevPrice) * quantityHeld
          priorValue += prevPrice * quantityHeld
        }

        // Shares bought exactly on `date` have no "prior day" to have moved
        // from — excluded above by design — but that doesn't mean their own
        // gain since purchase should wait until tomorrow to appear. Credited
        // here against the same price used above, so a same-day buy shows a
        // real number today instead of only from the next priced day onward.
        const sameDayBuys = buyTotals?.get(date)
        if (sameDayBuys) {
          dollarChange += currPrice * sameDayBuys.totalQty - sameDayBuys.totalCost
          priorValue += sameDayBuys.totalCost
        }

        if (i === 0 && !sameDayBuys) continue

        changes.push({
          date,
          dollarChange,
          percentChange: priorValue ? (dollarChange / priorValue) * 100 : null,
          priorValue,
        })
      }
      result[holding.ticker] = changes
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, historyByTicker, tradeEventsByTicker, buyTotalsByTickerDate])

  const allDates = useMemo(() => {
    const set = new Set()
    for (const changes of Object.values(changesByTicker)) {
      for (const change of changes) set.add(change.date)
    }
    return [...set].sort()
  }, [changesByTicker])

  const displayDates = useMemo(() => {
    if (range?.start && range?.end) {
      return allDates.filter((date) => date >= range.start && date <= range.end)
    }
    return allDates.slice(-defaultDayCount)
  }, [allDates, range, defaultDayCount])

  const rows = useMemo(() => {
    return holdings.map((holding) => {
      const changes = changesByTicker[holding.ticker] ?? []
      const byDate = new Map(changes.map((change) => [change.date, change]))
      const cells = displayDates.map((date) => byDate.get(date) ?? null)
      const validCells = cells.filter(Boolean)
      const totalDollar = validCells.length ? validCells.reduce((sum, c) => sum + c.dollarChange, 0) : null
      const totalPrior = validCells.reduce((sum, c) => sum + c.priorValue, 0)
      const totalPercent = totalPrior ? ((totalDollar ?? 0) / totalPrior) * 100 : null
      return { ticker: holding.ticker, cells, totalDollar, totalPercent }
    })
  }, [holdings, changesByTicker, displayDates])

  const dailyTotals = useMemo(() => {
    return displayDates.map((date) => {
      let dollar = 0
      let prior = 0
      let hasAny = false
      for (const changes of Object.values(changesByTicker)) {
        const entry = changes.find((c) => c.date === date)
        if (entry) {
          dollar += entry.dollarChange
          prior += entry.priorValue
          hasAny = true
        }
      }
      return {
        date,
        dollarChange: hasAny ? dollar : null,
        percentChange: prior ? (dollar / prior) * 100 : null,
      }
    })
  }, [displayDates, changesByTicker])

  return { allDates, displayDates, rows, dailyTotals, loading, error }
}
