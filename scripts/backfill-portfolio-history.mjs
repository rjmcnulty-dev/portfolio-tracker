// One-time script: reconstructs `portfolio_value_history` (all accounts
// combined), `account_value_history` (one row per account), and
// `ticker_price_history` (one row per ticker, for the Daily Gains table) for
// every day from your first trade up through yesterday (today's rows come
// from the regular daily price-refresh job instead, so both paths never
// disagree about "today"). Run this once after adding these tables —
// scripts/fetch-prices.mjs and the refresh-prices Edge Function take over
// from there, appending one new day at a time going forward.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... TWELVE_DATA_API_KEY=... npm run portfolio:backfill
import { createClient } from '@supabase/supabase-js'
import { getConfig } from './lib/config.mjs'
import { getSecret } from './lib/secrets.mjs'
import { getTradeTypeSets } from './lib/tradeTypes.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Twelve Data's free tier caps at 8 API credits/minute; unlike the /price
// endpoint, /time_series only accepts one symbol per call, so each ticker
// costs its own credit regardless of how much history it returns. DB-backed
// via app_config's twelve_data_rate_limit — this is the pre-config fallback.
const DEFAULT_RATE_LIMIT = { maxPerWindow: 8, windowMs: 61_000 }
const OUTPUT_SIZE = 5000 // generous upper bound; costs the same 1 credit either way

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10)
}

function addOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return toDateStr(d)
}

function yesterday() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return toDateStr(d)
}

// Fetches full daily close history for one ticker, oldest first.
async function fetchDailyHistory(ticker, apiKey) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&outputsize=${OUTPUT_SIZE}&apikey=${apiKey}`
  const res = await fetch(url)
  const body = await res.json()

  if (body.status === 'error' || body.code) {
    throw new Error(`Twelve Data error for ${ticker}: ${body.message || JSON.stringify(body)}`)
  }

  const values = body.values ?? []
  return values
    .map((v) => ({ date: v.datetime, close: Number(v.close) }))
    .filter((v) => !Number.isNaN(v.close))
    .reverse() // Twelve Data returns newest-first.
}

async function fetchAllHistories(tickers, apiKey, maxSymbolsPerMinute, rateLimitWindowMs) {
  const historyByTicker = new Map()

  for (let i = 0; i < tickers.length; i += maxSymbolsPerMinute) {
    const chunk = tickers.slice(i, i + maxSymbolsPerMinute)
    for (const ticker of chunk) {
      console.log(`Fetching history for ${ticker}…`)
      historyByTicker.set(ticker, await fetchDailyHistory(ticker, apiKey))
    }

    const hasMoreChunks = i + maxSymbolsPerMinute < tickers.length
    if (hasMoreChunks) {
      console.log('Waiting for the next per-minute credit window…')
      await sleep(rateLimitWindowMs)
    }
  }

  return historyByTicker
}

// Tracks a moving cursor into a ticker's sorted [{date, close}] history, so
// "closing price on or before this date" is O(1) amortized as the caller
// walks days in ascending order — a fresh linear/binary search per lookup
// isn't needed since backfill always walks forward chronologically.
function makePriceCursor(history) {
  let index = -1 // last index whose date <= the most recently queried date
  return function priceOnOrBefore(dateStr) {
    while (index + 1 < history.length && history[index + 1].date <= dateStr) {
      index += 1
    }
    return index >= 0 ? history[index].close : null
  }
}

// Returns { total, complete } — complete is false when the scope (overall or
// one account) has an open position in a ticker with no price data yet as of
// this date, meaning the value would be misleadingly incomplete rather than
// a real $0. A scope with no open positions at all (fully sold, or no trades
// yet reaching this date) is complete with total 0 — a real, meaningful value.
function computeHoldingsValue(quantityByTicker, date, priceCursors) {
  let total = 0
  let hasOpenPosition = false
  let hasGap = false
  for (const [ticker, quantity] of quantityByTicker) {
    if (quantity <= 0) continue
    hasOpenPosition = true
    const price = priceCursors.get(ticker)?.(date)
    if (price == null) {
      hasGap = true
      continue
    }
    total += quantity * price
  }
  return { total, complete: !hasOpenPosition || !hasGap }
}

async function main() {
  // Prefers the encrypted DB value (set from /admin's Secrets tab, requires
  // SUPABASE_SERVICE_ROLE_KEY here too) over the plain env var, so migrating
  // to encrypted secrets is zero-downtime.
  const twelveDataApiKey = (await getSecret('twelve_data_api_key')) ?? process.env.TWELVE_DATA_API_KEY
  if (!twelveDataApiKey) {
    console.error('No Twelve Data API key available (checked /admin-managed secret, then TWELVE_DATA_API_KEY env var)')
    process.exit(1)
  }

  const { data: trades, error: tradesError } = await supabase
    .from('trades')
    .select('ticker, trade_type, quantity, price, fees, cost_basis, trade_date, account')
    .order('trade_date', { ascending: true })
  if (tradesError) throw tradesError

  const { data: deposits, error: depositsError } = await supabase
    .from('deposits')
    .select('amount, deposit_date, account')
    .order('deposit_date', { ascending: true })
  if (depositsError) throw depositsError

  if (!trades.length && !deposits.length) {
    console.log('No trades or deposits found — nothing to backfill.')
    return
  }

  const tickers = [...new Set(trades.map((t) => t.ticker).filter(Boolean))]
  const firstDates = []
  if (trades.length) firstDates.push(trades[0].trade_date)
  if (deposits.length) firstDates.push(deposits[0].deposit_date)
  const startDate = firstDates.sort()[0]
  const endDate = yesterday()

  if (startDate > endDate) {
    console.log('Not enough elapsed history yet (first activity was today) — nothing to backfill.')
    return
  }

  console.log(`Backfilling ${startDate} through ${endDate} for ${tickers.length} ticker(s): ${tickers.join(', ')}`)

  const rateLimit = await getConfig(supabase, 'twelve_data_rate_limit', DEFAULT_RATE_LIMIT)
  const { buyLot, deductsCash } = await getTradeTypeSets(supabase)
  const historyByTicker = await fetchAllHistories(tickers, twelveDataApiKey, rateLimit.maxPerWindow, rateLimit.windowMs)
  const priceCursors = new Map([...historyByTicker].map(([ticker, history]) => [ticker, makePriceCursor(history)]))

  // ticker_price_history rides along for free — this history was already
  // fetched to compute portfolio value above. Bounded to the same
  // startDate..endDate window as everything else, not the full 5000-bar
  // fetch, so tickers with years of trading history before you ever bought
  // them don't bloat the table with rows nothing reads.
  const tickerHistoryRows = []
  for (const [ticker, history] of historyByTicker) {
    for (const point of history) {
      if (point.date < startDate || point.date > endDate) continue
      tickerHistoryRows.push({ ticker, as_of: point.date, price: point.close })
    }
  }
  const TICKER_HISTORY_BATCH_SIZE = 500
  for (let i = 0; i < tickerHistoryRows.length; i += TICKER_HISTORY_BATCH_SIZE) {
    const batch = tickerHistoryRows.slice(i, i + TICKER_HISTORY_BATCH_SIZE)
    const { error: tickerHistoryError } = await supabase
      .from('ticker_price_history')
      .upsert(batch, { onConflict: 'ticker,as_of' })
    if (tickerHistoryError) throw tickerHistoryError
  }
  if (tickerHistoryRows.length) {
    console.log(`Wrote ${tickerHistoryRows.length} ticker_price_history row(s).`)
  }

  // Trades/deposits grouped by date so each day's cash- and
  // holdings-changing events can be applied in one pass as the day-by-day
  // walk reaches that date.
  const tradesByDate = new Map()
  for (const trade of trades) {
    if (!tradesByDate.has(trade.trade_date)) tradesByDate.set(trade.trade_date, [])
    tradesByDate.get(trade.trade_date).push(trade)
  }
  const depositsByDate = new Map()
  for (const deposit of deposits) {
    if (!depositsByDate.has(deposit.deposit_date)) depositsByDate.set(deposit.deposit_date, [])
    depositsByDate.get(deposit.deposit_date).push(deposit)
  }

  const overallState = { cash: 0, quantityByTicker: new Map() }
  const accountStates = new Map() // account -> { cash, quantityByTicker }

  function getAccountState(account) {
    if (!accountStates.has(account)) accountStates.set(account, { cash: 0, quantityByTicker: new Map() })
    return accountStates.get(account)
  }

  function applyDeposit(deposit) {
    const amount = Number(deposit.amount) || 0
    overallState.cash += amount
    getAccountState(deposit.account).cash += amount
  }

  // Same cash-position formula as usePortfolio.js: a cash-deducting buy-lot
  // trade draws down cash by its cost, a SELL adds back proceeds (qty ×
  // price − fees) — independent of that row's own cost_basis, which is the
  // basis of the shares sold, not the cash received. A buy-lot type that
  // doesn't deduct cash (e.g. Dividend Reinvestment) still moves
  // signedQty/quantityByTicker below, just with no matching cashDelta.
  function applyTrade(trade) {
    const qty = Number(trade.quantity) || 0
    const price = Number(trade.price) || 0
    const fees = Number(trade.fees) || 0
    const costBasis = Number(trade.cost_basis) || 0
    const isBuy = buyLot.has(trade.trade_type)
    const isSell = trade.trade_type === 'SELL'
    const signedQty = isBuy ? qty : isSell ? -qty : 0
    const cashDelta = isBuy ? (deductsCash.has(trade.trade_type) ? -costBasis : 0) : isSell ? qty * price - fees : 0

    overallState.cash += cashDelta
    overallState.quantityByTicker.set(
      trade.ticker,
      (overallState.quantityByTicker.get(trade.ticker) || 0) + signedQty,
    )

    const accountState = getAccountState(trade.account)
    accountState.cash += cashDelta
    accountState.quantityByTicker.set(trade.ticker, (accountState.quantityByTicker.get(trade.ticker) || 0) + signedQty)
  }

  const portfolioRows = []
  const accountRows = []
  let skippedDays = 0
  let skippedAccountDays = 0

  for (let date = startDate; date <= endDate; date = addOneDay(date)) {
    for (const deposit of depositsByDate.get(date) ?? []) applyDeposit(deposit)
    for (const trade of tradesByDate.get(date) ?? []) applyTrade(trade)

    const overallHoldings = computeHoldingsValue(overallState.quantityByTicker, date, priceCursors)
    if (overallHoldings.complete) {
      portfolioRows.push({ snapshot_date: date, total_value: overallState.cash + overallHoldings.total })
    } else {
      skippedDays += 1
    }

    for (const [account, state] of accountStates) {
      const holdings = computeHoldingsValue(state.quantityByTicker, date, priceCursors)
      if (holdings.complete) {
        accountRows.push({ account, snapshot_date: date, total_value: state.cash + holdings.total })
      } else {
        skippedAccountDays += 1
      }
    }
  }

  if (!portfolioRows.length && !accountRows.length) {
    console.log('No days had enough price data to compute a value — nothing written.')
    return
  }

  if (portfolioRows.length) {
    const { error: upsertError } = await supabase
      .from('portfolio_value_history')
      .upsert(portfolioRows, { onConflict: 'snapshot_date' })
    if (upsertError) throw upsertError
  }

  if (accountRows.length) {
    const { error: accountUpsertError } = await supabase
      .from('account_value_history')
      .upsert(accountRows, { onConflict: 'account,snapshot_date' })
    if (accountUpsertError) throw accountUpsertError
  }

  console.log(
    `Wrote ${portfolioRows.length} day(s) of portfolio value history` +
      `${skippedDays ? ` (skipped ${skippedDays} day(s) with no price data yet)` : ''}, and ` +
      `${accountRows.length} account-day row(s)` +
      `${skippedAccountDays ? ` (skipped ${skippedAccountDays} account-day(s) with no price data yet)` : ''}.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
