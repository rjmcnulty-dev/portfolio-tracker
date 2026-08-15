// Powers the Stock Watch page's chart + next-earnings-date lookup. Called
// on demand from the browser (ticker add, range toggle) — nothing here is
// cached or scheduled, unlike the price-refresh/materialize jobs. Both
// TWELVE_DATA_API_KEY and FINNHUB_API_KEY stay Supabase secrets (or, once
// set from /admin, encrypted app_secrets rows) so neither reaches
// client-side JS.
import { createClient } from "@supabase/supabase-js";
import { getDecryptedSecret } from "../_shared/secrets.ts";

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
  high: number;
  low: number;
}

// high/low ride along for free — Twelve Data's time_series already returns
// full OHLC per bar, this just wasn't reading two of those fields until the
// Stochastic Oscillator (computeStochastic, client-side) needed them; no
// extra request param or API cost.
async function fetchSeries(ticker: string, range: string, apiKey: string): Promise<TimeSeriesPoint[]> {
  const { interval, outputsize } = RANGE_PARAMS[range] ?? RANGE_PARAMS["1M"];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
  const res = await fetch(url);
  const body = await res.json();

  if (body.status === "error" || body.code) {
    throw new Error(`Twelve Data error: ${body.message || JSON.stringify(body)}`);
  }

  const values: { datetime: string; close: string; high: string; low: string }[] = body.values ?? [];
  return values
    .map((v) => ({ date: v.datetime, close: Number(v.close), high: Number(v.high), low: Number(v.low) }))
    .filter((v) => !Number.isNaN(v.close) && !Number.isNaN(v.high) && !Number.isNaN(v.low))
    .reverse(); // Twelve Data returns newest-first; charts want oldest-first.
}

// Wide enough window to cover both needs from a single Finnhub call: 2 years
// back covers every range option's history (the longest, 200D at daily
// bars, spans well under that), 6 months forward preserves the existing
// "next earnings" lookahead. Returns every date in that window, sorted —
// the caller derives both nextEarningsDate (soonest future one) and
// earningsDates (whichever fall inside the currently-plotted range) from
// this same list, so it only costs one API call either way.
async function fetchEarningsCalendar(ticker: string, apiKey: string): Promise<string[]> {
  const twoYearsAgo = new Date();
  twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
  const from = twoYearsAgo.toISOString().slice(0, 10);

  const sixMonthsOut = new Date();
  sixMonthsOut.setUTCMonth(sixMonthsOut.getUTCMonth() + 6);
  const to = sixMonthsOut.toISOString().slice(0, 10);

  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok) {
    throw new Error(`Finnhub error: ${body.error || JSON.stringify(body)}`);
  }

  const entries: { date: string }[] = body.earningsCalendar ?? [];
  return entries.map((e) => e.date).sort();
}

interface CompanyProfile {
  companyName: string | null;
  floatShares: number | null;
  sharesOutstanding: number | null;
}

// Company name + float + shares outstanding, from one Finnhub call (much
// more generous free-tier limit, 60/min, than spending another Twelve Data
// credit against the tight 8/min budget the chart call already uses). Float
// and shares outstanding ride along for free — both were already in this
// same response, just unused until now. sharesOutstanding lets the client
// show float as a % of total shares (i.e. how much of the company is
// actually free-floating vs. closely held). Short interest was investigated
// too but isn't available on any free tier checked (Twelve Data's
// /statistics, Finnhub's dedicated short-interest endpoint) — see README's
// "Stock Watch" section.
async function fetchCompanyProfile(ticker: string, apiKey: string): Promise<CompanyProfile> {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return { companyName: null, floatShares: null, sharesOutstanding: null };
  const body = await res.json();
  return {
    companyName: body?.name || null,
    // Finnhub reports both of these in millions of shares (e.g. 1126.1 == ~1.13B).
    floatShares: typeof body?.floatingShare === "number" ? body.floatingShare : null,
    sharesOutstanding: typeof body?.shareOutstanding === "number" ? body.shareOutstanding : null,
  };
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

  // Prefers the encrypted DB value (set from /admin's Secrets tab) over the
  // Supabase secret, falling back to the latter if nothing's been saved to
  // /admin yet — so migrating to encrypted secrets is zero-downtime.
  const masterKey = Deno.env.get("CONFIG_ENCRYPTION_KEY");
  const twelveDataApiKey =
    (masterKey ? await getDecryptedSecret(supabase, "twelve_data_api_key", masterKey) : null) ??
    Deno.env.get("TWELVE_DATA_API_KEY");
  const finnhubApiKey =
    (masterKey ? await getDecryptedSecret(supabase, "finnhub_api_key", masterKey) : null) ??
    Deno.env.get("FINNHUB_API_KEY");
  if (!twelveDataApiKey || !finnhubApiKey) {
    return json({ error: "No Twelve Data / Finnhub API key configured (set them from /admin, or as Supabase secrets)" }, 500);
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
    const [series, earningsCalendar, profile] = await Promise.all([
      fetchSeries(ticker, range, twelveDataApiKey),
      fetchEarningsCalendar(ticker, finnhubApiKey),
      fetchCompanyProfile(ticker, finnhubApiKey).catch(() => ({
        companyName: null,
        floatShares: null,
        sharesOutstanding: null,
      })),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const nextEarningsDate = earningsCalendar.find((d) => d >= today) ?? null;

    // Markers for the chart itself — only earnings dates that actually fall
    // within the plotted range. Daily-bar ranges (1M/3M/6M/1Y/20D/50D/200D)
    // have plain "YYYY-MM-DD" points that line up with Finnhub's date
    // format; intraday ranges (1D/1W) use timestamped points
    // ("2026-08-14 09:30:00"), which never match a plain date here, so this
    // naturally yields no markers for those rather than a wrong one.
    const seriesDates = series.map((p) => p.date.slice(0, 10));
    const seriesStart = seriesDates[0];
    const seriesEnd = seriesDates[seriesDates.length - 1];
    const earningsDates =
      seriesStart && seriesEnd ? earningsCalendar.filter((d) => d >= seriesStart && d <= seriesEnd) : [];

    // Always-on list (independent of the currently selected chart range) of
    // reported earnings from the past year — most recent first. Distinct
    // from `earningsDates` above: that one only covers whatever's actually
    // visible on the current chart (nothing on a 1M view, most of a year on
    // 1Y/200D); this one is a fixed trailing window for the card's own
    // "Recent Earnings" text, so it's the same regardless of chart range.
    const oneYearAgo = new Date();
    oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 365);
    const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);
    const recentEarningsDates = earningsCalendar
      .filter((d) => d >= oneYearAgoStr && d <= today)
      .sort()
      .reverse();

    return json({
      series,
      nextEarningsDate,
      recentEarningsDates,
      earningsDates,
      companyName: profile.companyName,
      floatShares: profile.floatShares,
      sharesOutstanding: profile.sharesOutstanding,
    });
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
