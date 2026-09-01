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
//   - Upside >= 10% and trend score >= 2 (and, if buyRequireStochBullish is
//     on, %K above %D) → Buy.
//   - Upside <= -5% (price already past target) → Sell.
//   - Trend score <= 1 (downtrend) and price near a resistance level → Sell.
//   - Everything else → Hold.
//
// The thresholds below (proximity, upside/score cutoffs) are the fallback
// defaults; callers pass app_config's support_resistance_tuning.proximityPct
// and buy_sell_thresholds as `tuning` once loaded — see PerformanceEvaluator.jsx.
const DEFAULT_TUNING = {
  proximityPct: 0.03,
  buyUpsidePct: 10,
  buyMinScore: 2,
  sellUpsidePct: -5,
  sellMaxScoreNearResistance: 1,
  buyRequireStochBullish: false,
}

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

function isNear(currentPrice, level, proximityPct) {
  if (!level) return false
  return Math.abs(currentPrice - level.price) / currentPrice <= proximityPct
}

export function evaluatePosition(
  { currentPrice, targetPrice, sma20, sma50, sma200, support, resistance, stochK, stochD },
  tuning = {},
) {
  const { proximityPct, buyUpsidePct, buyMinScore, sellUpsidePct, sellMaxScoreNearResistance, buyRequireStochBullish } = {
    ...DEFAULT_TUNING,
    ...tuning,
  }
  // Only meaningful when buyRequireStochBullish is on — %K/%D aren't part of
  // the Sell/Hold rules at all, just an optional extra gate on Buy. Missing
  // data (stochK/stochD null) counts as not-bullish, not a free pass.
  const stochBullish = stochK != null && stochD != null && stochK > stochD
  const hasAnySMA = sma20 != null || sma50 != null || sma200 != null
  const score = trendScore(currentPrice, sma20, sma50, sma200)
  const trend = trendLabel(score, hasAnySMA)

  const nearestSupport = nearestLevel(support)
  const nearestResistance = nearestLevel(resistance)
  const nearSupport = isNear(currentPrice, nearestSupport, proximityPct)
  const nearResistance = isNear(currentPrice, nearestResistance, proximityPct)

  const upsidePct = targetPrice ? ((targetPrice - currentPrice) / currentPrice) * 100 : null

  const reasons = []
  let suggestion = 'Hold'

  const meetsBuyBar = upsidePct != null && upsidePct >= buyUpsidePct && score >= buyMinScore

  if (upsidePct == null) {
    reasons.push('No price target set — suggestion is trend-only until you set one on the Prices page.')
  } else if (meetsBuyBar && (!buyRequireStochBullish || stochBullish)) {
    suggestion = 'Buy'
    reasons.push(`${upsidePct.toFixed(1)}% upside to target`, `${trend.toLowerCase()} (above ${score}/3 moving averages)`)
    if (buyRequireStochBullish) reasons.push(`%K above %D (${stochK.toFixed(1)} > ${stochD.toFixed(1)})`)
  } else if (upsidePct <= sellUpsidePct) {
    suggestion = 'Sell'
    reasons.push(`Price is ${Math.abs(upsidePct).toFixed(1)}% above target`)
  } else if (score <= sellMaxScoreNearResistance && nearResistance) {
    suggestion = 'Sell'
    reasons.push(`${trend.toLowerCase()}`, `near resistance (~$${nearestResistance.price.toFixed(2)})`)
  } else {
    reasons.push(
      upsidePct != null ? `${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)}% to target` : null,
      `${trend.toLowerCase()}`,
      nearSupport ? `near support (~$${nearestSupport.price.toFixed(2)})` : null,
      meetsBuyBar && buyRequireStochBullish && !stochBullish
        ? `would be a Buy, but %K isn't above %D (${stochK?.toFixed(1) ?? '—'} vs ${stochD?.toFixed(1) ?? '—'})`
        : null,
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
