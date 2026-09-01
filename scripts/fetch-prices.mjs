import { createClient } from '@supabase/supabase-js'
import { getConfig } from './lib/config.mjs'
import { getSecret } from './lib/secrets.mjs'
import { getTradeTypeSets } from './lib/tradeTypes.mjs'
import { todayInEastern } from './lib/dates.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Twelve Data's free tier caps at 8 API credits/minute, and each symbol costs
// 1 credit even inside a single batched request — so a portfolio with more
// than 8 tickers has to be split across multiple per-minute windows. DB-backed
// via app_config's twelve_data_rate_limit — this is the pre-config fallback.
const DEFAULT_RATE_LIMIT = { maxPerWindow: 8, windowMs: 61_000 }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchQuotes(tickers, apiKey, maxSymbolsPerMinute, rateLimitWindowMs) {
  const quotes = {}

  for (let i = 0; i < tickers.length; i += maxSymbolsPerMinute) {
    const chunk = tickers.slice(i, i + maxSymbolsPerMinute)
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(chunk.join(','))}&apikey=${apiKey}`
    const res = await fetch(url)
    const body = await res.json()

    if (body.status === 'error' || body.code) {
      throw new Error(`Twelve Data error: ${body.message || JSON.stringify(body)}`)
    }

    // A single-symbol request returns { price: "..." } directly; a multi-symbol
    // request returns { SYMBOL: { price: "..." }, ... }.
    Object.assign(quotes, chunk.length === 1 ? { [chunk[0]]: body } : body)

    const hasMoreChunks = i + maxSymbolsPerMinute < tickers.length
    if (hasMoreChunks) {
      console.log(`Fetched ${chunk.length} ticker(s), waiting for the next per-minute credit window…`)
      await sleep(rateLimitWindowMs)
    }
  }

  return quotes
}

function computeQuantitiesByTicker(trades, buyLot) {
  const quantityByTicker = new Map()
  for (const trade of trades) {
    const qty = Number(trade.quantity) || 0
    const signed = buyLot.has(trade.trade_type) ? qty : trade.trade_type === 'SELL' ? -qty : 0
    quantityByTicker.set(trade.ticker, (quantityByTicker.get(trade.ticker) || 0) + signed)
  }
  return quantityByTicker
}

// Trades with no price in `quotes` (e.g. the fetch skipped a ticker) are
// excluded from the total rather than blocking the snapshot — same
// "best effort, don't let one bad symbol block everything" spirit as the
// rest of this job.
function computeHoldingsValue(quantityByTicker, quotes) {
  let total = 0
  for (const [ticker, quantity] of quantityByTicker) {
    if (quantity <= 0) continue
    const price = Number(quotes[ticker]?.price)
    if (Number.isNaN(price)) continue
    total += quantity * price
  }
  return total
}

// Same formula as usePortfolio.js's cashPosition: deposits add, cash-
// deducting buy-lot trades draw down by their cost, SELLs add back
// proceeds — a buy-lot type that doesn't deduct cash (e.g. Dividend
// Reinvestment) affects quantitiesByTicker/holdings value above but not
// this, since the money that paid for it was never recorded as cash either.
function computeCashPosition(deposits, trades, buyLot, deductsCash) {
  const totalDeposits = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0)
  const netTradeCash = trades.reduce((sum, trade) => {
    const quantity = Number(trade.quantity) || 0
    const price = Number(trade.price) || 0
    const fees = Number(trade.fees) || 0
    if (buyLot.has(trade.trade_type)) {
      return deductsCash.has(trade.trade_type) ? sum - (Number(trade.cost_basis) || 0) : sum
    }
    if (trade.trade_type === 'SELL') return sum + (quantity * price - fees)
    return sum
  }, 0)
  return totalDeposits + netTradeCash
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
    .select('ticker, trade_type, quantity, price, fees, cost_basis, account')
  if (tradesError) throw tradesError

  const { data: deposits, error: depositsError } = await supabase.from('deposits').select('amount, account')
  if (depositsError) throw depositsError

  // Benchmark tickers (e.g. SPY/QQQ/DIA) are never traded, so they'd
  // otherwise never get a price — union them in here so the comparison
  // chart's history keeps accumulating daily, same as any held ticker.
  // They never enter computeQuantitiesByTicker/computeHoldingsValue below
  // since those only iterate `trades`.
  const { data: benchmarks, error: benchmarksError } = await supabase.from('benchmarks').select('ticker')
  if (benchmarksError) throw benchmarksError

  const tickers = [...new Set([...trades.map((t) => t.ticker).filter(Boolean), ...(benchmarks ?? []).map((b) => b.ticker)])]
  if (!tickers.length) {
    console.log('No tickers found in trades or benchmarks — nothing to fetch.')
    return
  }

  const rateLimit = await getConfig(supabase, 'twelve_data_rate_limit', DEFAULT_RATE_LIMIT)
  const { buyLot, deductsCash } = await getTradeTypeSets(supabase)
  const quotes = await fetchQuotes(tickers, twelveDataApiKey, rateLimit.maxPerWindow, rateLimit.windowMs)

  const asOf = todayInEastern()
  const now = new Date().toISOString()
  const rows = []

  for (const ticker of tickers) {
    const quote = quotes[ticker]
    const price = Number(quote?.price)
    if (!quote || Number.isNaN(price)) {
      console.warn(`No price returned for ${ticker}, skipping`)
      continue
    }
    rows.push({ ticker, price, as_of: asOf, updated_at: now })
  }

  if (!rows.length) {
    console.log('No valid prices to write.')
    return
  }

  const { error: upsertError } = await supabase.from('ticker_prices').upsert(rows, { onConflict: 'ticker' })
  if (upsertError) throw upsertError

  // Same prices, no extra API cost — just also keeping a dated history
  // instead of only the latest, so the Daily Gains table can look up
  // yesterday's price per ticker.
  const historyRows = rows.map(({ ticker, price, as_of }) => ({ ticker, price, as_of }))
  const { error: historyError } = await supabase
    .from('ticker_price_history')
    .upsert(historyRows, { onConflict: 'ticker,as_of' })
  if (historyError) throw historyError

  console.log(`Updated prices for ${rows.length} ticker(s): ${rows.map((r) => r.ticker).join(', ')}`)

  const totalValue =
    computeCashPosition(deposits, trades, buyLot, deductsCash) +
    computeHoldingsValue(computeQuantitiesByTicker(trades, buyLot), quotes)
  const { error: snapshotError } = await supabase
    .from('portfolio_value_history')
    .upsert({ snapshot_date: asOf, total_value: totalValue }, { onConflict: 'snapshot_date' })
  if (snapshotError) throw snapshotError

  const tradesByAccount = new Map()
  for (const trade of trades) {
    if (!tradesByAccount.has(trade.account)) tradesByAccount.set(trade.account, [])
    tradesByAccount.get(trade.account).push(trade)
  }
  const depositsByAccount = new Map()
  for (const deposit of deposits) {
    if (!depositsByAccount.has(deposit.account)) depositsByAccount.set(deposit.account, [])
    depositsByAccount.get(deposit.account).push(deposit)
  }
  // Union of both maps' keys — an account with deposits but no trades yet
  // (or vice versa) still has a real, non-zero value and shouldn't be
  // silently dropped from account_value_history.
  const accountsWithActivity = new Set([...tradesByAccount.keys(), ...depositsByAccount.keys()])
  const accountRows = [...accountsWithActivity].map((account) => ({
    account,
    snapshot_date: asOf,
    total_value:
      computeCashPosition(depositsByAccount.get(account) ?? [], tradesByAccount.get(account) ?? [], buyLot, deductsCash) +
      computeHoldingsValue(computeQuantitiesByTicker(tradesByAccount.get(account) ?? [], buyLot), quotes),
  }))

  const { error: accountSnapshotError } = await supabase
    .from('account_value_history')
    .upsert(accountRows, { onConflict: 'account,snapshot_date' })
  if (accountSnapshotError) throw accountSnapshotError

  console.log(`Recorded portfolio value snapshot for ${asOf}: $${totalValue.toFixed(2)} (${accountRows.length} account(s))`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
