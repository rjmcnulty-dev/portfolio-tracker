// Turns the raw data the evaluate-performance Edge Function returns (price
// history-derived returns/SMAs/support-resistance) plus your own manually-set
// price target into a Buy/Hold/Sell suggestion. Kept as a pure, isolated
// function — not investment advice, just a transparent, explainable rule of
// thumb combining two signals you asked for: trend and price target.
//
// Trend: how many of SMA20/50/200 the current price sits above (0-3), plus
// whether price is currently hugging a known support/resistance level
// (within 3%).
// Target: % upside/downside between current price and your target, if set.
//
// Rules (checked in order):
//   - No target set → Hold, trend-only note (can't judge value without one).
//   - Upside >= 10% and trend score >= 2  → Buy.
//   - Upside <= -5% (price already past target) → Sell.
//   - Trend score <= 1 (downtrend) and price near a resistance level → Sell.
//   - Everything else → Hold.
const PROXIMITY_PCT = 0.03

function trendScore(currentPrice, sma20, sma50, sma200) {
  let score = 0
  if (sma20 != null && currentPrice > sma20) score += 1
  if (sma50 != null && currentPrice > sma50) score += 1
  if (sma200 != null && currentPrice > sma200) score += 1
  return score
}

function trendLabel(score, hasAnySMA) {
  if (!hasAnySMA) return 'Unknown'
  if (score === 3) return 'Strong Uptrend'
  if (score === 2) return 'Uptrend'
  if (score === 1) return 'Downtrend'
  return 'Strong Downtrend'
}

function nearestLevel(levels) {
  return levels?.length ? levels[0] : null
}

function isNear(currentPrice, level) {
  if (!level) return false
  return Math.abs(currentPrice - level.price) / currentPrice <= PROXIMITY_PCT
}

export function evaluatePosition({ currentPrice, targetPrice, sma20, sma50, sma200, support, resistance }) {
  const hasAnySMA = sma20 != null || sma50 != null || sma200 != null
  const score = trendScore(currentPrice, sma20, sma50, sma200)
  const trend = trendLabel(score, hasAnySMA)

  const nearestSupport = nearestLevel(support)
  const nearestResistance = nearestLevel(resistance)
  const nearSupport = isNear(currentPrice, nearestSupport)
  const nearResistance = isNear(currentPrice, nearestResistance)

  const upsidePct = targetPrice ? ((targetPrice - currentPrice) / currentPrice) * 100 : null

  const reasons = []
  let suggestion = 'Hold'

  if (upsidePct == null) {
    reasons.push('No price target set — suggestion is trend-only until you set one on the Prices page.')
  } else if (upsidePct >= 10 && score >= 2) {
    suggestion = 'Buy'
    reasons.push(`${upsidePct.toFixed(1)}% upside to target`, `${trend.toLowerCase()} (above ${score}/3 moving averages)`)
  } else if (upsidePct <= -5) {
    suggestion = 'Sell'
    reasons.push(`Price is ${Math.abs(upsidePct).toFixed(1)}% above target`)
  } else if (score <= 1 && nearResistance) {
    suggestion = 'Sell'
    reasons.push(`${trend.toLowerCase()}`, `near resistance (~$${nearestResistance.price.toFixed(2)})`)
  } else {
    reasons.push(
      upsidePct != null ? `${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)}% to target` : null,
      `${trend.toLowerCase()}`,
      nearSupport ? `near support (~$${nearestSupport.price.toFixed(2)})` : null,
    )
  }

  return {
    suggestion,
    trend,
    trendScore: score,
    upsidePct,
    nearSupport,
    nearResistance,
    reasons: reasons.filter(Boolean),
  }
}
