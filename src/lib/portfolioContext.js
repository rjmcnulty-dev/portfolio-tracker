// Recent trades only, not full history — bounds token cost on every turn
// while still covering the "what did I just buy" class of question. Both
// limits are belt-and-suspenders: the date window is what actually matters
// for relevance, the count cap just guards against an unusually
// high-frequency account blowing up the context size.
const RECENT_TRADES_DAYS = 60
const MAX_RECENT_TRADES = 100

function round2(value) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0
}

// Compact, derived snapshot sent to the AI Companion as system context —
// keeps token cost down and avoids re-deriving holdings logic a second time
// server-side. Computed once per chat session (see AiCompanionPage), not
// refetched per message, so the exact same JSON string is resent on every
// turn — which also makes it a clean prompt-cache hit across the whole
// conversation, not just a token-count optimization.
export function buildPortfolioContext({ kpis, holdings, allocation, cashPosition, trades }) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RECENT_TRADES_DAYS)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const recentTrades = (trades ?? [])
    .filter((t) => t.trade_date >= cutoffStr)
    .sort((a, b) => (a.trade_date < b.trade_date ? 1 : -1))
    .slice(0, MAX_RECENT_TRADES)
    .map((t) => ({
      date: t.trade_date,
      ticker: t.ticker,
      type: t.trade_type,
      quantity: t.quantity,
      price: round2(t.price),
      account: t.account,
    }))

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
    recentTradesWindowDays: RECENT_TRADES_DAYS,
    recentTrades,
  }
}
