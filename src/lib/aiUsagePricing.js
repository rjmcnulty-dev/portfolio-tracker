export const EMPTY_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  web_search_requests: 0,
}

// Anthropic's per-request `usage` field names, kept as-is (snake_case)
// throughout the client rather than translated to camelCase — one less
// mapping layer between what the API returns, what gets logged to
// ai_usage_log, and what's summed/displayed here.
export function sumUsage(a, b) {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    web_search_requests: (a.web_search_requests ?? 0) + (b.web_search_requests ?? 0),
  }
}

// Estimated, not billing-accurate — computed from token counts (plus a flat
// per-search fee for the web search tool, billed separately from tokens)
// against configurable rates (ai_companion_pricing in app_config), not
// pulled from Anthropic's actual account billing. Good enough to track
// relative spend and catch a runaway conversation, not a substitute for
// checking the Anthropic console for real numbers.
export function estimateCost(usage, pricing) {
  const inputCost = ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok
  const outputCost = ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok
  const cacheWriteCost = ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * pricing.cacheWritePerMTok
  const cacheReadCost = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.cacheReadPerMTok
  const webSearchCost = (usage.web_search_requests ?? 0) * pricing.webSearchPerSearch
  return inputCost + outputCost + cacheWriteCost + cacheReadCost + webSearchCost
}
