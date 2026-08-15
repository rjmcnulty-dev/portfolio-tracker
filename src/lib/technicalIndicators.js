// Computed entirely client-side from a chart's already-fetched price series —
// no extra API calls, which matters given Twelve Data's tight free-tier
// per-minute budget (see useStockQuote).

export function computeSMA(series, period) {
  if (series.length < period) return []
  const points = []
  let sum = 0
  for (let i = 0; i < series.length; i++) {
    sum += series[i].close
    if (i >= period) sum -= series[i - period].close
    if (i >= period - 1) {
      points.push({ date: series[i].date, value: sum / period })
    }
  }
  return points
}

// On Balance Volume: a running total that adds a bar's volume when it
// closes higher than the prior bar, subtracts it when lower, and leaves it
// unchanged on an unmoved close — cumulative buying/selling pressure. Unlike
// Stochastic, OBV isn't bounded (it's a running sum of daily share volume,
// so it trends into the millions/billions over a long enough series) — only
// its direction/slope and divergence from the price trend are meaningful,
// never its absolute level. First point is seeded at 0, not the first bar's
// volume, since there's no "prior close" to compare it against yet.
export function computeOBV(series) {
  if (!series.length) return []
  const points = [{ date: series[0].date, value: 0 }]
  let obv = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i].close > series[i - 1].close) obv += series[i].volume
    else if (series[i].close < series[i - 1].close) obv -= series[i].volume
    points.push({ date: series[i].date, value: obv })
  }
  return points
}

// A `period`-bar simple moving average of a {date, value} point series —
// same math as computeSMA above, but over already-computed indicator
// points (e.g. raw %K, or OBV — see WatchlistCard's OBV trend line)
// instead of raw price bars.
export function smoothPoints(points, period) {
  if (period <= 1) return points
  const result = []
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    sum += points[i].value
    if (i >= period) sum -= points[i - period].value
    if (i >= period - 1) {
      result.push({ date: points[i].date, value: sum / period })
    }
  }
  return result
}

// Stochastic Oscillator: %K measures where the close sits within the
// high/low range of the trailing `kPeriod` bars (0 = at the period's low,
// 100 = at its high); %D is a `dPeriod`-bar SMA of %K, a signal line. %K
// itself is smoothed by `kSmoothing` bars first — this is the commonly
// charted "slow" stochastic (kSmoothing=1 would give the noisier "fast"
// variant). A flat high==low window (e.g. a halted or illiquid ticker) is
// scored 50 (neither overbought nor oversold) rather than dividing by zero.
export function computeStochastic(series, kPeriod = 14, kSmoothing = 3, dPeriod = 3) {
  if (series.length < kPeriod) return { k: [], d: [] }

  const rawK = []
  for (let i = kPeriod - 1; i < series.length; i++) {
    const window = series.slice(i - kPeriod + 1, i + 1)
    const highestHigh = Math.max(...window.map((p) => p.high))
    const lowestLow = Math.min(...window.map((p) => p.low))
    const range = highestHigh - lowestLow
    const value = range === 0 ? 50 : ((series[i].close - lowestLow) / range) * 100
    rawK.push({ date: series[i].date, value })
  }

  const k = smoothPoints(rawK, kSmoothing)
  const d = smoothPoints(k, dPeriod)
  return { k, d }
}

function findSwingPoints(series, window) {
  const highs = []
  const lows = []
  for (let i = window; i < series.length - window; i++) {
    const closes = series.slice(i - window, i + window + 1).map((p) => p.close)
    const current = series[i].close
    if (current === Math.max(...closes)) highs.push(current)
    if (current === Math.min(...closes)) lows.push(current)
  }
  return { highs, lows }
}

function clusterLevels(levels, tolerancePct) {
  if (!levels.length) return []
  const sorted = [...levels].sort((a, b) => a - b)
  const clusters = [[sorted[0]]]

  for (let i = 1; i < sorted.length; i++) {
    const current = clusters[clusters.length - 1]
    const avg = current.reduce((sum, v) => sum + v, 0) / current.length
    if (Math.abs(sorted[i] - avg) / avg <= tolerancePct) {
      current.push(sorted[i])
    } else {
      clusters.push([sorted[i]])
    }
  }

  return clusters
    .map((cluster) => ({
      price: cluster.reduce((sum, v) => sum + v, 0) / cluster.length,
      strength: cluster.length,
    }))
    .sort((a, b) => b.strength - a.strength)
}

// Heuristic support/resistance: price levels the series touched multiple
// times at a local swing high/low, clustered by proximity — not just the
// period's absolute min/max. This is a chart aid, not authoritative
// technical analysis; a level with more "strength" (touches) is a stronger
// candidate but there's no guarantee it holds going forward. tolerancePct/
// swingWindowPct/maxLevels default to app_config's support_resistance_tuning
// values as of when this was wired up — callers pass the live config value.
export function findSupportResistance(series, maxLevels = 2, tolerancePct = 0.015, swingWindowPct = 0.03) {
  if (series.length < 10) return { support: [], resistance: [] }
  const window = Math.max(2, Math.round(series.length * swingWindowPct))
  const { highs, lows } = findSwingPoints(series, window)
  return {
    resistance: clusterLevels(highs, tolerancePct).slice(0, maxLevels),
    support: clusterLevels(lows, tolerancePct).slice(0, maxLevels),
  }
}

// Merges named indicator point-series (e.g. SMA lines) back into the main
// chart data by date, so Recharts can plot every line off one shared array.
export function mergeIndicators(series, indicators) {
  const maps = indicators.map(({ key, points }) => [key, new Map(points.map((p) => [p.date, p.value]))])
  return series.map((point) => {
    const extra = {}
    for (const [key, map] of maps) {
      extra[key] = map.get(point.date)
    }
    return { ...point, ...extra }
  })
}
