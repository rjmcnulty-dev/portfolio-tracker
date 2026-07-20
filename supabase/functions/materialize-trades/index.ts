// On-demand counterpart to scripts/materialize-trades.mjs (which runs on
// the GitHub Actions weekday schedule) — same occurrence-generation logic,
// but callable from the browser's "Sync Now" button so a newly created
// schedule doesn't have to wait for the next scheduled run.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the Edge
// Functions runtime; the service role client bypasses RLS for this trusted
// server-side job (auth verification of the caller is handled by the
// platform gateway via `verify_jwt = false` + the public apikey header).
import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const STEP_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14 };

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Same day-of-month as start_date, each month; clamped to the last day of
// shorter months (e.g. a Jan 31 start lands on Feb 28/29, not Mar 3).
function addMonthsClamped(startDateStr: string, months: number): string {
  const d = new Date(`${startDateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d.toISOString().slice(0, 10);
}

interface Schedule {
  id: string;
  account: string;
  ticker: string;
  dollar_amount: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
}

function occurrencesUpTo(schedule: Schedule, today: string): string[] {
  const { start_date, frequency, end_date } = schedule;
  const cap = end_date && end_date < today ? end_date : today;
  const dates: string[] = [];

  if (frequency === "monthly") {
    let i = 0;
    let cursor = start_date;
    while (cursor <= cap) {
      dates.push(cursor);
      i += 1;
      cursor = addMonthsClamped(start_date, i);
    }
    return dates;
  }

  const step = STEP_DAYS[frequency];
  let cursor = start_date;
  while (cursor <= cap) {
    dates.push(cursor);
    cursor = addDays(cursor, step);
  }
  return dates;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase runtime env vars are missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: schedules, error: schedulesError } = await supabase
    .from("trade_schedules")
    .select("*")
    .eq("active", true);
  if (schedulesError) {
    return json({ error: schedulesError.message }, 500);
  }

  if (!schedules?.length) {
    return json({ message: "No active trade schedules.", inserted: [] });
  }

  const tickers = [...new Set((schedules as Schedule[]).map((s) => s.ticker))];
  const { data: priceRows, error: pricesError } = await supabase
    .from("ticker_prices")
    .select("ticker, price")
    .in("ticker", tickers);
  if (pricesError) {
    return json({ error: pricesError.message }, 500);
  }

  const priceByTicker = new Map(
    (priceRows ?? []).map((p: { ticker: string; price: number }) => [p.ticker, Number(p.price)]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  const skippedTickers = new Set<string>();

  for (const schedule of schedules as Schedule[]) {
    if (schedule.start_date > today) continue;

    const price = priceByTicker.get(schedule.ticker);
    if (!price) {
      skippedTickers.add(schedule.ticker);
      continue;
    }

    for (const trade_date of occurrencesUpTo(schedule, today)) {
      const quantity = schedule.dollar_amount / price;
      rows.push({
        account: schedule.account,
        ticker: schedule.ticker,
        trade_type: "BUY",
        quantity,
        price,
        trade_date,
        fees: 0,
        cost_basis: schedule.dollar_amount,
        market_price: price,
        market_value: schedule.dollar_amount,
        realized_pnl: 0,
        unrealized_pnl: 0,
        wash_sale_risk: "OK",
        schedule_id: schedule.id,
        notes: schedule.notes ? `Auto-generated: ${schedule.notes}` : "Auto-generated recurring trade",
      });
    }
  }

  if (!rows.length) {
    const message = skippedTickers.size
      ? `No recurring trades due. No cached price for: ${[...skippedTickers].join(", ")}.`
      : "No recurring trades due.";
    return json({ message, inserted: [] });
  }

  const { data: inserted, error: upsertError } = await supabase
    .from("trades")
    .upsert(rows, { onConflict: "schedule_id,trade_date", ignoreDuplicates: true })
    .select();
  if (upsertError) {
    return json({ error: upsertError.message }, 500);
  }

  const message =
    `Materialized ${inserted?.length ?? 0} new trade(s).` +
    (skippedTickers.size ? ` No cached price for: ${[...skippedTickers].join(", ")}.` : "");

  return json({ message, inserted: (inserted ?? []).map((r: { trade_date: string }) => r.trade_date) });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/materialize-trades'

*/
