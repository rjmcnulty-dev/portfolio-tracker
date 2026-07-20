import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const STEP_DAYS = { daily: 1, weekly: 7, biweekly: 14 }

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Same day-of-month as start_date, each month; clamped to the last day of
// shorter months (e.g. a Jan 31 start lands on Feb 28/29, not Mar 3).
function addMonthsClamped(startDateStr, months) {
  const d = new Date(`${startDateStr}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, daysInMonth))
  return d.toISOString().slice(0, 10)
}

function occurrencesUpTo({ start_date, frequency, end_date }, today) {
  const cap = end_date && end_date < today ? end_date : today
  const dates = []

  if (frequency === 'monthly') {
    let i = 0
    let cursor = start_date
    while (cursor <= cap) {
      dates.push(cursor)
      i += 1
      cursor = addMonthsClamped(start_date, i)
    }
    return dates
  }

  const step = STEP_DAYS[frequency]
  let cursor = start_date
  while (cursor <= cap) {
    dates.push(cursor)
    cursor = addDays(cursor, step)
  }
  return dates
}

async function main() {
  const { data: schedules, error: schedulesError } = await supabase
    .from('trade_schedules')
    .select('*')
    .eq('active', true)
  if (schedulesError) throw schedulesError

  if (!schedules?.length) {
    console.log('No active trade schedules.')
    return
  }

  // Purchase price is whatever's currently cached in ticker_prices — this
  // job doesn't call Twelve Data itself, it relies on the price-refresh job
  // having run for these tickers already.
  const tickers = [...new Set(schedules.map((s) => s.ticker))]
  const { data: priceRows, error: pricesError } = await supabase
    .from('ticker_prices')
    .select('ticker, price')
    .in('ticker', tickers)
  if (pricesError) throw pricesError

  const priceByTicker = new Map(priceRows.map((p) => [p.ticker, Number(p.price)]))

  const today = new Date().toISOString().slice(0, 10)
  const rows = []
  const skippedTickers = new Set()

  for (const schedule of schedules) {
    if (schedule.start_date > today) continue

    const price = priceByTicker.get(schedule.ticker)
    if (!price) {
      skippedTickers.add(schedule.ticker)
      continue
    }

    for (const trade_date of occurrencesUpTo(schedule, today)) {
      const quantity = schedule.dollar_amount / price
      rows.push({
        account: schedule.account,
        ticker: schedule.ticker,
        trade_type: 'BUY',
        quantity,
        price,
        trade_date,
        fees: 0,
        cost_basis: schedule.dollar_amount,
        market_price: price,
        market_value: schedule.dollar_amount,
        realized_pnl: 0,
        unrealized_pnl: 0,
        wash_sale_risk: 'OK',
        schedule_id: schedule.id,
        notes: schedule.notes ? `Auto-generated: ${schedule.notes}` : 'Auto-generated recurring trade',
      })
    }
  }

  if (skippedTickers.size) {
    console.warn(
      `No cached price for: ${[...skippedTickers].join(', ')} — run the price refresh first. Their schedules were skipped this run.`,
    )
  }

  if (!rows.length) {
    console.log('No recurring trades due.')
    return
  }

  const { data: inserted, error: upsertError } = await supabase
    .from('trades')
    .upsert(rows, { onConflict: 'schedule_id,trade_date', ignoreDuplicates: true })
    .select()
  if (upsertError) throw upsertError

  console.log(
    `Materialized ${inserted?.length ?? 0} new trade(s) (checked ${rows.length} possible occurrence(s) across ${schedules.length} schedule(s)).`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
