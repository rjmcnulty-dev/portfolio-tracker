import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TWELVE_DATA_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY, TWELVE_DATA_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function main() {
  const { data: trades, error: tradesError } = await supabase.from('trades').select('ticker')
  if (tradesError) throw tradesError

  const tickers = [...new Set(trades.map((t) => t.ticker).filter(Boolean))]
  if (!tickers.length) {
    console.log('No tickers found in trades — nothing to fetch.')
    return
  }

  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tickers.join(','))}&apikey=${TWELVE_DATA_API_KEY}`
  const res = await fetch(url)
  const body = await res.json()

  if (body.status === 'error' || body.code) {
    throw new Error(`Twelve Data error: ${body.message || JSON.stringify(body)}`)
  }

  // A single-symbol request returns { price: "..." } directly; a multi-symbol
  // request returns { SYMBOL: { price: "..." }, ... }.
  const quotes = tickers.length === 1 ? { [tickers[0]]: body } : body

  const asOf = new Date().toISOString().slice(0, 10)
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

  console.log(`Updated prices for ${rows.length} ticker(s): ${rows.map((r) => r.ticker).join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
