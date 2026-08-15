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
import { getConfig } from "../_shared/config.ts";

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
// should move to a queued/background approach instead. DB-backed via
// app_config's twelve_data_rate_limit — this is the pre-config fallback.
const DEFAULT_RATE_LIMIT = { maxPerWindow: 8, windowMs: 61_000 };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchQuotes(
  tickers: string[],
  apiKey: string,
  maxSymbolsPerMinute: number,
  rateLimitWindowMs: number,
): Promise<Record<string, { price?: string }>> {
  const quotes: Record<string, { price?: string }> = {};

  for (let i = 0; i < tickers.length; i += maxSymbolsPerMinute) {
    const chunk = tickers.slice(i, i + maxSymbolsPerMinute);
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(chunk.join(","))}&apikey=${apiKey}`;
    const res = await fetch(url);
    const body = await res.json();

    if (body.status === "error" || body.code) {
      throw new Error(`Twelve Data error: ${body.message || JSON.stringify(body)}`);
    }

    // A single-symbol request returns { price: "..." } directly; a multi-symbol
    // request returns { SYMBOL: { price: "..." }, ... }.
    Object.assign(quotes, chunk.length === 1 ? { [chunk[0]]: body } : body);

    const hasMoreChunks = i + maxSymbolsPerMinute < tickers.length;
    if (hasMoreChunks) {
      await sleep(rateLimitWindowMs);
    }
  }

  return quotes;
}

// 'Scheduled Buy' behaves identically to 'BUY' for holdings purposes — kept
// as a separate literal (rather than sharing src/lib/tradeTypes.js) since
// Edge Functions are a separate Deno deploy unit from the Vite/React build.
const BUY_TRADE_TYPES = ["BUY", "Scheduled Buy"];

interface TradeForSnapshot {
  ticker: string;
  trade_type: string;
  quantity: number;
  price: number;
  fees: number;
  cost_basis: number;
  account: string;
}

interface DepositForSnapshot {
  amount: number;
  account: string;
}

function computeQuantitiesByTicker(trades: TradeForSnapshot[]): Map<string, number> {
  const quantityByTicker = new Map<string, number>();
  for (const trade of trades) {
    const qty = Number(trade.quantity) || 0;
    const signed = BUY_TRADE_TYPES.includes(trade.trade_type) ? qty : trade.trade_type === "SELL" ? -qty : 0;
    quantityByTicker.set(trade.ticker, (quantityByTicker.get(trade.ticker) || 0) + signed);
  }
  return quantityByTicker;
}

function computeHoldingsValue(
  quantityByTicker: Map<string, number>,
  quotes: Record<string, { price?: string }>,
): number {
  let total = 0;
  for (const [ticker, quantity] of quantityByTicker) {
    if (quantity <= 0) continue;
    const price = Number(quotes[ticker]?.price);
    if (Number.isNaN(price)) continue;
    total += quantity * price;
  }
  return total;
}

// Same formula as usePortfolio.js's cashPosition: deposits add, BUYs draw
// down by their cost, SELLs add back proceeds.
function computeCashPosition(deposits: DepositForSnapshot[], trades: TradeForSnapshot[]): number {
  const totalDeposits = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const netTradeCash = trades.reduce((sum, trade) => {
    const quantity = Number(trade.quantity) || 0;
    const price = Number(trade.price) || 0;
    const fees = Number(trade.fees) || 0;
    if (BUY_TRADE_TYPES.includes(trade.trade_type)) return sum - (Number(trade.cost_basis) || 0);
    if (trade.trade_type === "SELL") return sum + (quantity * price - fees);
    return sum;
  }, 0);
  return totalDeposits + netTradeCash;
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
  const rateLimit = await getConfig(supabase, "twelve_data_rate_limit", DEFAULT_RATE_LIMIT);

  // Optional { ticker: "AAPL" } body targets a single symbol — used by the
  // per-row "Auto Update" button — instead of refreshing every held ticker.
  let requestedTicker: string | null = null;
  try {
    const body = await req.json();
    if (body?.ticker) requestedTicker = String(body.ticker).trim().toUpperCase();
  } catch {
    // No body (or invalid JSON) — fall through to refreshing everything.
  }

  let tickers: string[];
  let allTrades: TradeForSnapshot[] = [];
  let allDeposits: DepositForSnapshot[] = [];
  if (requestedTicker) {
    tickers = [requestedTicker];
  } else {
    const { data: trades, error: tradesError } = await supabase
      .from("trades")
      .select("ticker, trade_type, quantity, price, fees, cost_basis, account");
    if (tradesError) {
      return json({ error: tradesError.message }, 500);
    }
    allTrades = trades ?? [];
    tickers = [...new Set(allTrades.map((t) => t.ticker).filter(Boolean))];

    const { data: deposits, error: depositsError } = await supabase.from("deposits").select("amount, account");
    if (depositsError) {
      return json({ error: depositsError.message }, 500);
    }
    allDeposits = deposits ?? [];
  }

  if (!tickers.length) {
    return json({ message: "No tickers found in trades — nothing to fetch.", updated: [] });
  }

  let quotes: Record<string, { price?: string }>;
  try {
    quotes = await fetchQuotes(tickers, twelveDataApiKey, rateLimit.maxPerWindow, rateLimit.windowMs);
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

  // Same prices, no extra API cost — also keeps a dated history instead of
  // only the latest, so the Daily Gains table can look up yesterday's price
  // per ticker. Unlike the portfolio/account snapshots below, this is worth
  // doing even for a single-ticker "Auto Update" — one ticker's history is
  // still useful, unlike a portfolio total that needs every holding priced.
  const historyRows = rows.map(({ ticker, price, as_of }) => ({ ticker, price, as_of }));
  const { error: historyError } = await supabase
    .from("ticker_price_history")
    .upsert(historyRows, { onConflict: "ticker,as_of" });
  if (historyError) {
    return json({ error: historyError.message }, 500);
  }

  // Only a full refresh (every held ticker) reflects a real day's portfolio
  // value — a single-ticker "Auto Update" doesn't have prices for the rest
  // of the holdings, so it can't produce a meaningful snapshot.
  if (!requestedTicker) {
    const totalValue =
      computeCashPosition(allDeposits, allTrades) + computeHoldingsValue(computeQuantitiesByTicker(allTrades), quotes);
    const { error: snapshotError } = await supabase
      .from("portfolio_value_history")
      .upsert({ snapshot_date: asOf, total_value: totalValue }, { onConflict: "snapshot_date" });
    if (snapshotError) {
      return json({ error: snapshotError.message }, 500);
    }

    const tradesByAccount = new Map<string, TradeForSnapshot[]>();
    for (const trade of allTrades) {
      if (!tradesByAccount.has(trade.account)) tradesByAccount.set(trade.account, []);
      tradesByAccount.get(trade.account)!.push(trade);
    }
    const depositsByAccount = new Map<string, DepositForSnapshot[]>();
    for (const deposit of allDeposits) {
      if (!depositsByAccount.has(deposit.account)) depositsByAccount.set(deposit.account, []);
      depositsByAccount.get(deposit.account)!.push(deposit);
    }
    // Union of both maps' keys — an account with deposits but no trades yet
    // (or vice versa) still has a real, non-zero value and shouldn't be
    // silently dropped from account_value_history.
    const accountsWithActivity = new Set([...tradesByAccount.keys(), ...depositsByAccount.keys()]);
    const accountRows = [...accountsWithActivity].map((account) => ({
      account,
      snapshot_date: asOf,
      total_value:
        computeCashPosition(depositsByAccount.get(account) ?? [], tradesByAccount.get(account) ?? []) +
        computeHoldingsValue(computeQuantitiesByTicker(tradesByAccount.get(account) ?? []), quotes),
    }));

    const { error: accountSnapshotError } = await supabase
      .from("account_value_history")
      .upsert(accountRows, { onConflict: "account,snapshot_date" });
    if (accountSnapshotError) {
      return json({ error: accountSnapshotError.message }, 500);
    }
  }

  return json({ message: `Updated ${rows.length} ticker(s).`, updated: rows.map((r) => r.ticker) });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/refresh-prices'

*/
