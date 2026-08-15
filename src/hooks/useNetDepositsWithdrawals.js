import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Deposits/withdrawals within [rangeStart, rangeEnd] for one account — used
// to explain the gap between the Daily Gains table's price-only cells and
// the account's Starting->Ending value change (see useAccountValueBounds).
// Withdrawals are deposits rows with a negative amount (see DepositForm.jsx),
// so totalDeposits/totalWithdrawals split on sign rather than a stored type.
export function useNetDepositsWithdrawals(account, rangeStart, rangeEnd) {
  const [totalDeposits, setTotalDeposits] = useState(0)
  const [totalWithdrawals, setTotalWithdrawals] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const latestRequestId = useRef(0)

  const load = useCallback(async () => {
    if (!account || !rangeStart || !rangeEnd) {
      setTotalDeposits(0)
      setTotalWithdrawals(0)
      setLoading(false)
      return
    }

    const requestId = ++latestRequestId.current
    setLoading(true)

    // account === 'All' means every account, not a literal account name —
    // same convention as useDeposits/usePortfolioValueHistory.
    let query = supabase.from('deposits').select('amount').gte('deposit_date', rangeStart).lte('deposit_date', rangeEnd)
    if (account !== 'All') {
      query = query.eq('account', account)
    }
    const { data, error: fetchError } = await query

    if (requestId !== latestRequestId.current) return

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    setError(null)
    let deposits = 0
    let withdrawals = 0
    for (const row of data ?? []) {
      const amount = Number(row.amount) || 0
      if (amount >= 0) deposits += amount
      else withdrawals += -amount
    }
    setTotalDeposits(deposits)
    setTotalWithdrawals(withdrawals)
    setLoading(false)
  }, [account, rangeStart, rangeEnd])

  useEffect(() => {
    load()
  }, [load])

  return {
    totalDeposits,
    totalWithdrawals,
    netAmount: totalDeposits - totalWithdrawals,
    loading,
    error,
  }
}
