// Node counterpart to supabase/functions/_shared/tradeTypes.ts and
// src/lib/tradeTypes.js's module-level cache — this script runs as a
// separate process outside both, so it fetches trade_types for itself.
// Falls back to the original hardcoded BUY/Scheduled Buy set if the table
// is missing or empty, same "zero-downtime migration" pattern as
// scripts/lib/config.mjs's getConfig.
export async function getTradeTypeSets(supabase) {
  const fallback = { buyLot: new Set(['BUY', 'Scheduled Buy']), deductsCash: new Set(['BUY', 'Scheduled Buy']) }
  const { data, error } = await supabase.from('trade_types').select('value, deducts_cash')
  if (error || !data || !data.length) return fallback
  return {
    // Whitelist (known type, not SELL), not "anything that isn't SELL" —
    // matches isBuyTrade's own reasoning in src/lib/tradeTypes.js.
    buyLot: new Set(data.filter((t) => t.value !== 'SELL').map((t) => t.value)),
    deductsCash: new Set(data.filter((t) => t.deducts_cash).map((t) => t.value)),
  }
}
