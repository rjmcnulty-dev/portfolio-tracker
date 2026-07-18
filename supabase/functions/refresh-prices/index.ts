// On-demand counterpart to scripts/fetch-prices.mjs (which runs on the
// GitHub Actions schedule) — same Twelve Data -> ticker_prices logic, but
// callable from the browser's "Update All Prices" button. TWELVE_DATA_API_KEY
// stays a Supabase secret here so it's never bundled into client-side JS.
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

// Twelve Data's free tier caps at 8 API credits/minute, and each symbol costs
// 1 credit even inside a single batched request — so a portfolio with more
// than 8 tickers has to be split across multiple per-minute windows. Fine for
// a modest ticker count; if this ever grows past ~16-24 tickers, the wait
// time will start pushing against Edge Function execution limits and this
// should move to a queued/background approach instead.
const MAX_SYMBOLS_PER_MINUTE = 8;
const RATE_LIMIT_WINDOW_MS = 61_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchQuotes(tickers: string[], apiKey: string): Promise<Record<string, { price?: string }>> {
  const quotes: Record<string, { price?: string }> = {};

  for (let i = 0; i < tickers.length; i += MAX_SYMBOLS_PER_MINUTE) {
    const chunk = tickers.slice(i, i + MAX_SYMBOLS_PER_MINUTE);
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(chunk.join(","))}&apikey=${apiKey}`;
    const res = await fetch(url);
    const body = await res.json();

    if (body.status === "error" || body.code) {
      throw new Error(`Twelve Data error: ${body.message || JSON.stringify(body)}`);
    }

    // A single-symbol request returns { price: "..." } directly; a multi-symbol
    // request returns { SYMBOL: { price: "..." }, ... }.
    Object.assign(quotes, chunk.length === 1 ? { [chunk[0]]: body } : body);

    const hasMoreChunks = i + MAX_SYMBOLS_PER_MINUTE < tickers.length;
    if (hasMoreChunks) {
      await sleep(RATE_LIMIT_WINDOW_MS);
    }
  }

  return quotes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const twelveDataApiKey = Deno.env.get("TWELVE_DATA_API_KEY");
  if (!twelveDataApiKey) {
    return json({ error: "TWELVE_DATA_API_KEY is not configured" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase runtime env vars are missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: trades, error: tradesError } = await supabase.from("trades").select("ticker");
  if (tradesError) {
    return json({ error: tradesError.message }, 500);
  }

  const tickers = [...new Set((trades ?? []).map((t) => t.ticker).filter(Boolean))];
  if (!tickers.length) {
    return json({ message: "No tickers found in trades — nothing to fetch.", updated: [] });
  }

  let quotes: Record<string, { price?: string }>;
  try {
    quotes = await fetchQuotes(tickers, twelveDataApiKey);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const rows: { ticker: string; price: number; as_of: string; updated_at: string }[] = [];

  for (const ticker of tickers) {
    const quote = quotes[ticker];
    const price = Number(quote?.price);
    if (!quote || Number.isNaN(price)) continue;
    rows.push({ ticker, price, as_of: asOf, updated_at: now });
  }

  if (!rows.length) {
    return json({ message: "No valid prices returned.", updated: [] });
  }

  const { error: upsertError } = await supabase.from("ticker_prices").upsert(rows, { onConflict: "ticker" });
  if (upsertError) {
    return json({ error: upsertError.message }, 500);
  }

  return json({ message: `Updated ${rows.length} ticker(s).`, updated: rows.map((r) => r.ticker) });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/refresh-prices'

*/
