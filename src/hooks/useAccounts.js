import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAccounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setAccounts(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const addAccount = useCallback(
    async (name) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Account name is required')
      const { error: insertError } = await supabase.from('accounts').insert({ name: trimmed })
      if (insertError) throw insertError
      await fetchAccounts()
    },
    [fetchAccounts],
  )

  const deleteAccount = useCallback(
    async (id, name) => {
      // The FK constraints on trades/deposits/deposit_schedules/trade_schedules
      // already block this at the DB level (no ON DELETE CASCADE), but a raw
      // FK-violation error isn't a useful message — check first so we can say
      // specifically what's still attached.
      const [trades, deposits, depositSchedules, tradeSchedules] = await Promise.all([
        supabase.from('trades').select('id', { count: 'exact', head: true }).eq('account', name),
        supabase.from('deposits').select('id', { count: 'exact', head: true }).eq('account', name),
        supabase.from('deposit_schedules').select('id', { count: 'exact', head: true }).eq('account', name),
        supabase.from('trade_schedules').select('id', { count: 'exact', head: true }).eq('account', name),
      ])

      const blockers = []
      if (trades.count) blockers.push(`${trades.count} trade${trades.count === 1 ? '' : 's'}`)
      if (deposits.count) blockers.push(`${deposits.count} deposit${deposits.count === 1 ? '' : 's'}`)
      if (depositSchedules.count) {
        blockers.push(`${depositSchedules.count} recurring deposit schedule${depositSchedules.count === 1 ? '' : 's'}`)
      }
      if (tradeSchedules.count) {
        blockers.push(`${tradeSchedules.count} recurring trade schedule${tradeSchedules.count === 1 ? '' : 's'}`)
      }

      if (blockers.length) {
        throw new Error(`Can't delete — this account still has ${blockers.join(', ')}.`)
      }

      const { error: deleteError } = await supabase.from('accounts').delete().eq('id', id)
      if (deleteError) throw deleteError
      await fetchAccounts()
    },
    [fetchAccounts],
  )

  return { accounts, loading, error, addAccount, deleteAccount, refetch: fetchAccounts }
}
