// Powers the on-demand Performance Evaluator (Dashboard + each account
// page). For each held ticker, fetches 1 year of daily closes from Twelve
// Data and computes trailing 1/3/6/12-month returns, SMA20/50/200, and
// support/resistance levels server-side. The client combines that with your
// own manually-set price target (price_targets table — analyst consensus
// targets aren't available on the free-tier APIs this app uses; Finnhub's
// /stock/price-target 403s on the free tier, and Twelve Data's
// /price_target is ultra/enterprise-plan only) to produce a Buy/Hold/Sell
// suggestion (src/lib/performanceEvaluator.js). This function only fetches
// and computes price-history inputs, it doesn't decide anything, so the
// suggestion logic can be tuned without a redeploy.
//
// TWELVE_DATA_API_KEY stays a Supabase secret so it never reaches
// client-side JS.
import { createClient } from "@supabase/supabase-js";
import { getConfig } from "../_shared/config.ts";
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Twelve Data's free tier caps at 8 API credits/minute — same budget the
// other price-fetching jobs in this app ration against. DB-backed via
// app_config's twelve_data_rate_limit — this is the pre-config fallback.
const DEFAULT_RATE_LIMIT = { maxPerWindow: 8, windowMs: 61_000 };
const DEFAULT_MA_PERIODS = [20, 50, 200];
const DEFAULT_SR_TUNING = { tolerancePct: 0.015, swingWindowPct: 0.03, maxLevelsDefault: 2 };

interface SeriesPoint {
  date: string;
  close: number;
}

async function fetchSeries(ticker: string, apiKey: string): Promise<SeriesPoint[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&outputsize=365&apikey=${apiKey}`;
  const res = await fetch(url);
  const body = await res.json();

  if (body.status === "error" || body.code) {
    throw new Error(`Twelve Data error for ${ticker}: ${body.message || JSON.stringify(body)}`);
  }

  const values: { datetime: string; close: string }[] = body.values ?? [];
  return values
    .map((v) => ({ date: v.datetime, close: Number(v.close) }))
    .filter((v) => !Number.isNaN(v.close))
    .reverse(); // Twelve Data returns newest-first; oldest-first is easier to walk.
}

// "N months ago" resolved against the actual series rather than a fixed
// trading-day offset, then the closing price on or before that date — a
// simple backward scan since a 1-year series is small (≤365 points).
function priceMonthsAgo(series: SeriesPoint[], months: number): number | null {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let candidate: SeriesPoint | null = null;
  for (const point of series) {
    if (point.date > cutoffStr) break;
    candidate = point;
  }
  return candidate?.close ?? null;
}

function computeReturns(series: SeriesPoint[]): Record<string, number | null> {
  if (!series.length) return { "1m": null, "3m": null, "6m": null, "12m": null };
  const latest = series[series.length - 1].close;

  const returnFor = (months: number) => {
    const past = priceMonthsAgo(series, months);
    if (past == null || past === 0) return null;
    return ((latest - past) / past) * 100;
  };

  return {
    "1m": returnFor(1),
    "3m": returnFor(3),
    "6m": returnFor(6),
    "12m": returnFor(12),
  };
}

// Simple average of the last `period` closes — same definition as
// src/lib/technicalIndicators.js's computeSMA, just returning only the
// latest value instead of the full point series (that's all a single
// current-trend snapshot needs).
function latestSMA(series: SeriesPoint[], period: number): number | null {
  if (series.length < period) return null;
  const window = series.slice(series.length - period);
  return window.reduce((sum, p) => sum + p.close, 0) / period;
}

interface Level {
  price: number;
  strength: number;
}

function findSwingPoints(series: SeriesPoint[], window: number): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = window; i < series.length - window; i++) {
    const closes = series.slice(i - window, i + window + 1).map((p) => p.close);
    const current = series[i].close;
    if (current === Math.max(...closes)) highs.push(current);
    if (current === Math.min(...closes)) lows.push(current);
  }
  return { highs, lows };
}

function clusterLevels(levels: number[], tolerancePct: number): Level[] {
  if (!levels.length) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const current = clusters[clusters.length - 1];
    const avg = current.reduce((sum, v) => sum + v, 0) / current.length;
    if (Math.abs(sorted[i] - avg) / avg <= tolerancePct) {
      current.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }

  return clusters
    .map((cluster) => ({
      price: cluster.reduce((sum, v) => sum + v, 0) / cluster.length,
      strength: cluster.length,
    }))
    .sort((a, b) => b.strength - a.strength);
}

function findSupportResistance(
  series: SeriesPoint[],
  maxLevels: number,
  tolerancePct: number,
  swingWindowPct: number,
): { support: Level[]; resistance: Level[] } {
  if (series.length < 10) return { support: [], resistance: [] };
  const window = Math.max(2, Math.round(series.length * swingWindowPct));
  const { highs, lows } = findSwingPoints(series, window);
  return {
    resistance: clusterLevels(highs, tolerancePct).slice(0, maxLevels),
    support: clusterLevels(lows, tolerancePct).slice(0, maxLevels),
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
  const apiKey =
    (masterKey ? await getDecryptedSecret(supabase, "twelve_data_api_key", masterKey) : null) ??
    Deno.env.get("TWELVE_DATA_API_KEY");
  if (!apiKey) {
    return json({ error: "No Twelve Data API key configured (set one from /admin or TWELVE_DATA_API_KEY)" }, 500);
  }

  const rateLimit = await getConfig(supabase, "twelve_data_rate_limit", DEFAULT_RATE_LIMIT);
  const maPeriods = await getConfig(supabase, "moving_average_periods", DEFAULT_MA_PERIODS);
  const srTuning = await getConfig(supabase, "support_resistance_tuning", DEFAULT_SR_TUNING);

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

  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (let i = 0; i < tickers.length; i += rateLimit.maxPerWindow) {
    const chunk = tickers.slice(i, i + rateLimit.maxPerWindow);

    await Promise.all(
      chunk.map(async (ticker) => {
        try {
          const series = await fetchSeries(ticker, apiKey);

          if (!series.length) {
            errors[ticker] = "No price history returned";
            return;
          }

          const { support, resistance } = findSupportResistance(
            series,
            srTuning.maxLevelsDefault,
            srTuning.tolerancePct,
            srTuning.swingWindowPct,
          );

          results[ticker] = {
            currentPrice: series[series.length - 1].close,
            returns: computeReturns(series),
            sma20: latestSMA(series, maPeriods[0]),
            sma50: latestSMA(series, maPeriods[1]),
            sma200: latestSMA(series, maPeriods[2]),
            support,
            resistance,
          };
        } catch (err) {
          errors[ticker] = err instanceof Error ? err.message : String(err);
        }
      }),
    );

    const hasMoreChunks = i + rateLimit.maxPerWindow < tickers.length;
    if (hasMoreChunks) {
      await sleep(rateLimit.windowMs);
    }
  }

  return json({ results, errors });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/evaluate-performance' \
    --data '{"tickers":["AAPL","MSFT"]}'

*/
