import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isBuyTrade } from '../lib/tradeTypes'

const DEFAULT_DAY_COUNT = 5

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
export function useDailyGains(holdings, trades, range) {
  const [historyByTicker, setHistoryByTicker] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const tickers = useMemo(() => holdings.map((h) => h.ticker).sort(), [holdings])
  const tickersKey = tickers.join(',')

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
  }, [tickersKey])

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

  const changesByTicker = useMemo(() => {
    const result = {}
    for (const holding of holdings) {
      const history = historyByTicker[holding.ticker] ?? []
      const changes = []
      for (let i = 1; i < history.length; i++) {
        const prevPrice = history[i - 1].price
        const currPrice = history[i].price
        const date = history[i].as_of
        const quantityHeld = quantityBefore(holding.ticker, date)
        changes.push({
          date,
          dollarChange: (currPrice - prevPrice) * quantityHeld,
          percentChange: prevPrice ? ((currPrice - prevPrice) / prevPrice) * 100 : null,
          priorValue: prevPrice * quantityHeld,
        })
      }
      result[holding.ticker] = changes
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, historyByTicker, tradeEventsByTicker])

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
    return allDates.slice(-DEFAULT_DAY_COUNT)
  }, [allDates, range])

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
