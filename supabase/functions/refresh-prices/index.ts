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

  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tickers.join(","))}&apikey=${twelveDataApiKey}`;
  const res = await fetch(url);
  const body = await res.json();

  if (body.status === "error" || body.code) {
    return json({ error: `Twelve Data error: ${body.message || JSON.stringify(body)}` }, 502);
  }

  // A single-symbol request returns { price: "..." } directly; a multi-symbol
  // request returns { SYMBOL: { price: "..." }, ... }.
  const quotes = tickers.length === 1 ? { [tickers[0]]: body } : body;

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
