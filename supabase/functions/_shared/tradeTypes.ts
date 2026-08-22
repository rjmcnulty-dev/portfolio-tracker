// Server-side counterpart to src/lib/tradeTypes.js's module-level cache —
// Edge Functions are a separate Deno deploy unit, so they read trade_types
// for themselves on each invocation instead of sharing that cache. Falls
// back to the original hardcoded BUY/Scheduled Buy set if the table is
// missing or empty, same "zero-downtime migration" pattern as _shared/
// config.ts's getConfig.
// deno-lint-ignore no-explicit-any
export async function getTradeTypeSets(supabase: any): Promise<{ buyLot: Set<string>; deductsCash: Set<string> }> {
  const fallback = { buyLot: new Set(["BUY", "Scheduled Buy"]), deductsCash: new Set(["BUY", "Scheduled Buy"]) };
  const { data, error } = await supabase.from("trade_types").select("value, deducts_cash");
  if (error || !data || !data.length) return fallback;
  return {
    // Whitelist (known type, not SELL), not "anything that isn't SELL" —
    // matches isBuyTrade's own reasoning in src/lib/tradeTypes.js.
    // deno-lint-ignore no-explicit-any
    buyLot: new Set(data.filter((t: any) => t.value !== "SELL").map((t: any) => t.value)),
    // deno-lint-ignore no-explicit-any
    deductsCash: new Set(data.filter((t: any) => t.deducts_cash).map((t: any) => t.value)),
  };
}
