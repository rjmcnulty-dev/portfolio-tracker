import { createClient } from '@supabase/supabase-js'
import { todayInEastern } from './lib/dates.mjs'

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
    .from('deposit_schedules')
    .select('*')
    .eq('active', true)
  if (schedulesError) throw schedulesError

  const today = todayInEastern()
  const rows = []

  for (const schedule of schedules ?? []) {
    if (schedule.start_date > today) continue

    for (const deposit_date of occurrencesUpTo(schedule, today)) {
      rows.push({
        account: schedule.account,
        amount: schedule.amount,
        deposit_date,
        deposit_type: schedule.deposit_type,
        schedule_id: schedule.id,
        notes: schedule.notes ? `Auto-generated: ${schedule.notes}` : 'Auto-generated recurring deposit',
      })
    }
  }

  if (!rows.length) {
    console.log('No recurring deposits due.')
    return
  }

  const { data: inserted, error: upsertError } = await supabase
    .from('deposits')
    .upsert(rows, { onConflict: 'schedule_id,deposit_date', ignoreDuplicates: true })
    .select()

  if (upsertError) throw upsertError

  console.log(
    `Materialized ${inserted?.length ?? 0} new deposit(s) (checked ${rows.length} possible occurrence(s) across ${schedules.length} schedule(s)).`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
