// A "% change from the range's first day" chart (BenchmarkComparisonChart's
// lines, PortfolioValueChart's Change figure) is meaningless if that first
// day's value is a near-zero pre-funding artifact — a tiny leftover/test
// balance before the account's real first deposit. Dividing by a
// near-zero denominator blows the percentage up to millions of percent.
//
// Finds the earliest date at or after `requestedStart` whose total_value
// clears `floorFraction` of the account's most recent value — effectively
// "don't start the chart before the account had real money in it" — without
// needing to hardcode a per-account date. Never returns a date earlier than
// `requestedStart`; falls back to it if nothing in history clears the floor
// (e.g. a brand-new account that's still tiny everywhere).
export function getEffectiveStartDate(history, requestedStart, floorFraction = 0.01) {
  if (!history.length) return requestedStart

  const currentValue = Math.abs(Number(history[history.length - 1].total_value))
  if (!currentValue) return requestedStart
  const floor = currentValue * floorFraction

  for (const row of history) {
    if (requestedStart && row.snapshot_date < requestedStart) continue
    if (Math.abs(Number(row.total_value)) >= floor) return row.snapshot_date
  }
  return requestedStart
}
