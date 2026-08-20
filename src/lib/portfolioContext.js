function round2(value) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0
}

// Compact, derived-only snapshot (never raw trade rows) sent to the AI
// Companion as system context — keeps token cost down and avoids
// re-deriving holdings logic a second time server-side. Computed once per
// chat session (see AiCompanionPage), not refetched per message, so the
// exact same JSON string is resent on every turn — which also makes it a
// clean prompt-cache hit across the whole conversation, not just a token-
// count optimization.
export function buildPortfolioContext({ kpis, holdings, allocation, cashPosition }) {
  return {
    asOf: new Date().toISOString(),
    kpis: {
      totalInvested: round2(kpis.invested),
      totalMarketValue: round2(kpis.marketValue),
      unrealizedPnl: round2(kpis.unrealizedPnl),
      realizedPnl: round2(kpis.realizedPnl),
      totalPnl: round2(kpis.totalPnl),
    },
    cashPosition: round2(cashPosition),
    holdings: holdings.map((h) => ({
      ticker: h.ticker,
      quantity: h.quantity,
      avgCost: round2(h.avgCost),
      currentPrice: round2(h.currentPrice),
      marketValue: round2(h.marketValue),
      unrealizedPnl: round2(h.unrealizedPnl),
      unrealizedPct: round2(h.unrealizedPct),
    })),
    allocationPct: allocation.map((a) => ({ ticker: a.ticker, pct: round2(a.pct) })),
  }
}
