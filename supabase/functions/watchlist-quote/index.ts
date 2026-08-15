// Powers the Stock Watch page's chart + next-earnings-date lookup. Called
// on demand from the browser (ticker add, range toggle) — nothing here is
// cached or scheduled, unlike the price-refresh/materialize jobs. Both
// TWELVE_DATA_API_KEY and FINNHUB_API_KEY stay Supabase secrets so neither
// reaches client-side JS.
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

// 20D/50D/200D fetch 2x their named period (not just N days) so the
// matching moving average — MA20/50/200, computed client-side in
// WatchlistCard from this series — has enough leading history to render as
// a full line spanning the whole named period, rather than a single
// trailing point (computeSMA needs `period` days of history before its
// first point, so exactly `period` days of output would show none at all).
const RANGE_PARAMS: Record<string, { interval: string; outputsize: number }> = {
  "1D": { interval: "5min", outputsize: 80 },
  "1W": { interval: "30min", outputsize: 70 },
  "1M": { interval: "1day", outputsize: 30 },
  "3M": { interval: "1day", outputsize: 90 },
  "6M": { interval: "1day", outputsize: 180 },
  "1Y": { interval: "1day", outputsize: 365 },
  "20D": { interval: "1day", outputsize: 40 },
  "50D": { interval: "1day", outputsize: 100 },
  "200D": { interval: "1day", outputsize: 400 },
};

interface TimeSeriesPoint {
  date: string;
  close: number;
}

async function fetchSeries(ticker: string, range: string, apiKey: string): Promise<TimeSeriesPoint[]> {
  const { interval, outputsize } = RANGE_PARAMS[range] ?? RANGE_PARAMS["1M"];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
  const res = await fetch(url);
  const body = await res.json();

  if (body.status === "error" || body.code) {
    throw new Error(`Twelve Data error: ${body.message || JSON.stringify(body)}`);
  }

  const values: { datetime: string; close: string }[] = body.values ?? [];
  return values
    .map((v) => ({ date: v.datetime, close: Number(v.close) }))
    .filter((v) => !Number.isNaN(v.close))
    .reverse(); // Twelve Data returns newest-first; charts want oldest-first.
}

async function fetchNextEarningsDate(ticker: string, apiKey: string): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsOut = new Date();
  sixMonthsOut.setUTCMonth(sixMonthsOut.getUTCMonth() + 6);
  const to = sixMonthsOut.toISOString().slice(0, 10);

  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${to}&symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok) {
    throw new Error(`Finnhub error: ${body.error || JSON.stringify(body)}`);
  }

  const entries: { date: string }[] = body.earningsCalendar ?? [];
  if (!entries.length) return null;

  return entries.map((e) => e.date).sort()[0];
}

// Company name, via Finnhub's much more generous free-tier limit (60/min)
// rather than spending another Twelve Data credit against the tight 8/min
// budget the chart call already uses.
async function fetchCompanyName(ticker: string, apiKey: string): Promise<string | null> {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  return body?.name || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const twelveDataApiKey = Deno.env.get("TWELVE_DATA_API_KEY");
  const finnhubApiKey = Deno.env.get("FINNHUB_API_KEY");
  if (!twelveDataApiKey || !finnhubApiKey) {
    return json({ error: "TWELVE_DATA_API_KEY or FINNHUB_API_KEY is not configured" }, 500);
  }

  let ticker: string | null = null;
  let range = "1M";
  try {
    const body = await req.json();
    if (body?.ticker) ticker = String(body.ticker).trim().toUpperCase();
    if (body?.range && RANGE_PARAMS[body.range]) range = body.range;
  } catch {
    // fall through to the "ticker required" error below
  }

  if (!ticker) {
    return json({ error: "A ticker is required" }, 400);
  }

  try {
    const [series, nextEarningsDate, companyName] = await Promise.all([
      fetchSeries(ticker, range, twelveDataApiKey),
      fetchNextEarningsDate(ticker, finnhubApiKey),
      fetchCompanyName(ticker, finnhubApiKey).catch(() => null),
    ]);

    return json({ series, nextEarningsDate, companyName });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/watchlist-quote' \
    --data '{"ticker":"AAPL","range":"1M"}'

*/
