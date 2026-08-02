// 'Scheduled Buy' is a distinct trade_type from 'BUY' purely for display —
// it marks a trade as auto-materialized from a recurring trade schedule
// rather than manually entered. Everywhere that cares whether a trade opened
// a position (holdings, cost basis, cash draw-down, eligible sell lots)
// needs to treat both the same way, so that logic goes through here instead
// of comparing against 'BUY' directly.
export const TRADE_TYPES = ['BUY', 'SELL', 'Scheduled Buy']
export const BUY_TRADE_TYPES = ['BUY', 'Scheduled Buy']

export function isBuyTrade(tradeType) {
  return BUY_TRADE_TYPES.includes(tradeType)
}
