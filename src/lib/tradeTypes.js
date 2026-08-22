// Trade types are DB-backed (see the `trade_types` table, managed from
// /admin's Trade Types tab) so a custom type — e.g. "Dividend Reinvestment"
// — can be added without a code change. BUY, SELL, and 'Scheduled Buy' stay
// hardcoded here as the permanent fallback and as the one place SELL's
// special "closes a lot, needs wash-sale/lot-matching" behavior is assumed;
// every other known type (core or custom) is treated as a buy-lot type.
//
// Module-level cache, configured once (see Layout.jsx's effect calling
// configureTradeTypes) — same pattern as twelveDataQueue's rate limit: every
// existing isBuyTrade(tradeType) call site stays a plain one-argument
// function, so this refactor didn't need to touch the ~10 files that call
// it. Edge Functions and Node scripts can't share this module-level state
// (separate deploy units/processes) — they fetch trade_types for themselves
// via _shared/tradeTypes.ts / scripts/lib/tradeTypes.mjs instead.
const DEFAULT_TRADE_TYPES = [
  { value: 'BUY', is_core: true, deducts_cash: true },
  { value: 'SELL', is_core: true, deducts_cash: false },
  { value: 'Scheduled Buy', is_core: true, deducts_cash: true },
]

let allTradeTypes = DEFAULT_TRADE_TYPES
let buyLotValues = new Set(['BUY', 'Scheduled Buy'])
let cashDeductingValues = new Set(['BUY', 'Scheduled Buy'])

export function configureTradeTypes(tradeTypes) {
  if (!tradeTypes?.length) return
  allTradeTypes = tradeTypes
  buyLotValues = new Set(tradeTypes.filter((t) => t.value !== 'SELL').map((t) => t.value))
  cashDeductingValues = new Set(tradeTypes.filter((t) => t.deducts_cash).map((t) => t.value))
}

// Whitelist semantics (known buy-lot type), not "anything that isn't SELL"
// — an unrecognized/stale trade_type value is treated as neither a buy nor
// a sell rather than silently counted as an open lot.
export function isBuyTrade(tradeType) {
  return buyLotValues.has(tradeType)
}

// Whether recording this trade draws down cash the way a normal BUY does —
// false for a type like Dividend Reinvestment, where the shares were paid
// for by a dividend that was never added to cash in the first place, so the
// net cash effect should be zero, not negative.
export function tradeDeductsCash(tradeType) {
  return cashDeductingValues.has(tradeType)
}

export function getTradeTypeValues() {
  return allTradeTypes.map((t) => t.value)
}

// Array form of the same buyLotValues Set isBuyTrade() checks against —
// needed wherever a Supabase `.in('trade_type', ...)` filter wants the
// list directly (e.g. fetching open lots eligible to close a SELL against).
export function getBuyLotValues() {
  return [...buyLotValues]
}
