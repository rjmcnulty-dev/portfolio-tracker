// One-time/occasional script: fetches a benchmark ticker's full Twelve Data
// daily close history and writes it into ticker_price_history — the same
// table scripts/fetch-prices.mjs appends to going forward. Run after adding
// a new benchmark from /admin so its comparison line has history
// immediately instead of only accumulating from today forward.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... TWELVE_DATA_API_KEY=... npm run benchmarks:backfill
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... TWELVE_DATA_API_KEY=... npm run benchmarks:backfill -- SPY
import { createClient } from '@supabase/supabase-js'
import { getConfig } from './lib/config.mjs'
import { getSecret } from './lib/secrets.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Twelve Data's free tier caps at 8 API credits/minute; /time_series only
// accepts one symbol per call, so each ticker costs its own credit
// regardless of how much history it returns. DB-backed via app_config's
// twelve_data_rate_limit — this is the pre-config fallback.
const DEFAULT_RATE_LIMIT = { maxPerWindow: 8, windowMs: 61_000 }
const OUTPUT_SIZE = 5000 // generous upper bound; costs the same 1 credit either way
const UPSERT_BATCH_SIZE = 500

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Identical to backfill-portfolio-history.mjs's function of the same name —
// duplicated rather than imported, since that script's rate-limiting/state
// walk is scoped to reconstructing portfolio value from trades+deposits, a
// different concern from just seeding one ticker's raw price series.
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

async function main() {
  // Prefers the encrypted DB value (set from /admin's Secrets tab, requires
  // SUPABASE_SERVICE_ROLE_KEY here too) over the plain env var, so migrating
  // to encrypted secrets is zero-downtime.
  const twelveDataApiKey = (await getSecret('twelve_data_api_key')) ?? process.env.TWELVE_DATA_API_KEY
  if (!twelveDataApiKey) {
    console.error('No Twelve Data API key available (checked /admin-managed secret, then TWELVE_DATA_API_KEY env var)')
    process.exit(1)
  }

  const requestedTicker = process.argv[2]?.trim().toUpperCase()
  const { data: benchmarks, error: benchmarksError } = await supabase.from('benchmarks').select('ticker')
  if (benchmarksError) throw benchmarksError

  const targets = requestedTicker ? (benchmarks ?? []).filter((b) => b.ticker === requestedTicker) : benchmarks ?? []
  if (!targets.length) {
    console.log(requestedTicker ? `No benchmark with ticker "${requestedTicker}" found.` : 'No benchmarks to backfill.')
    return
  }

  const rateLimit = await getConfig(supabase, 'twelve_data_rate_limit', DEFAULT_RATE_LIMIT)

  // Only wait after using up a full per-minute window's worth of credits
  // (maxPerWindow tickers), not after every single ticker — matches
  // fetchAllHistories in backfill-portfolio-history.mjs. With the default 3
  // seeded benchmarks and an 8/minute limit, this fetches all of them
  // back-to-back with no waiting at all.
  for (let i = 0; i < targets.length; i += rateLimit.maxPerWindow) {
    const chunk = targets.slice(i, i + rateLimit.maxPerWindow)
    for (const { ticker } of chunk) {
      console.log(`Fetching full history for ${ticker}…`)
      const history = await fetchDailyHistory(ticker, twelveDataApiKey)
      const rows = history.map((h) => ({ ticker, as_of: h.date, price: h.close }))

      for (let j = 0; j < rows.length; j += UPSERT_BATCH_SIZE) {
        const batch = rows.slice(j, j + UPSERT_BATCH_SIZE)
        const { error: upsertError } = await supabase.from('ticker_price_history').upsert(batch, { onConflict: 'ticker,as_of' })
        if (upsertError) throw upsertError
      }
      console.log(`Wrote ${rows.length} row(s) for ${ticker}.`)
    }

    const hasMoreChunks = i + rateLimit.maxPerWindow < targets.length
    if (hasMoreChunks) {
      console.log('Waiting for the next per-minute credit window…')
      await sleep(rateLimit.windowMs)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
