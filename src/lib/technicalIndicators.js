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
// candidate but there's no guarantee it holds going forward.
export function findSupportResistance(series, maxLevels = 2) {
  if (series.length < 10) return { support: [], resistance: [] }
  const window = Math.max(2, Math.round(series.length * 0.03))
  const { highs, lows } = findSwingPoints(series, window)
  return {
    resistance: clusterLevels(highs, 0.015).slice(0, maxLevels),
    support: clusterLevels(lows, 0.015).slice(0, maxLevels),
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
