// Powers the Prices page ticker-hover tooltip. Batch-fetches company names
// for a list of tickers via Finnhub only (no Twelve Data call) — Finnhub's
// free tier is 60 calls/minute, generous enough to fetch every held ticker
// in parallel on each Prices page load without any rate-limit chunking,
// unlike the 8/minute Twelve Data budget the price-refresh jobs have to
// carefully ration. FINNHUB_API_KEY stays a Supabase secret (or, once set
// from /admin, an encrypted app_secrets row) so it's never bundled into
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
  const finnhubApiKey =
    (masterKey ? await getDecryptedSecret(supabase, "finnhub_api_key", masterKey) : null) ??
    Deno.env.get("FINNHUB_API_KEY");
  if (!finnhubApiKey) {
    return json({ error: "No Finnhub API key configured (set one from /admin or FINNHUB_API_KEY)" }, 500);
  }

  let tickers: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.tickers)) {
      tickers = [...new Set(body.tickers.map((t: unknown) => String(t).trim().toUpperCase()).filter(Boolean))];
    }
  } catch {
    // fall through to the "tickers required" error below
  }

  if (!tickers.length) {
    return json({ error: "A non-empty tickers array is required" }, 400);
  }

  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        return [ticker, await fetchCompanyName(ticker, finnhubApiKey)] as const;
      } catch {
        // One bad symbol shouldn't fail the whole batch.
        return [ticker, null] as const;
      }
    }),
  );

  return json({ names: Object.fromEntries(entries) });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/company-names' \
    --data '{"tickers":["AAPL","MSFT"]}'

*/
