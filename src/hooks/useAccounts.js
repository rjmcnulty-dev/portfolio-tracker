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
      .order('sort_order', { ascending: true })

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

      // Append at the end of the current order rather than relying on the
      // column default (0), which would put every new account first.
      const { data: lastAccount, error: lastError } = await supabase
        .from('accounts')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastError) throw lastError
      const nextOrder = (lastAccount?.sort_order ?? -1) + 1

      const { error: insertError } = await supabase.from('accounts').insert({ name: trimmed, sort_order: nextOrder })
      if (insertError) throw insertError
      await fetchAccounts()
    },
    [fetchAccounts],
  )

  // Swaps sort_order with the adjacent account so the move is a single
  // transposition rather than renumbering the whole list.
  const moveAccount = useCallback(
    async (id, direction) => {
      const index = accounts.findIndex((a) => a.id === id)
      if (index === -1) return
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= accounts.length) return

      const current = accounts[index]
      const neighbor = accounts[swapIndex]

      const [{ error: errorA }, { error: errorB }] = await Promise.all([
        supabase.from('accounts').update({ sort_order: neighbor.sort_order }).eq('id', current.id),
        supabase.from('accounts').update({ sort_order: current.sort_order }).eq('id', neighbor.id),
      ])
      if (errorA) throw errorA
      if (errorB) throw errorB

      await fetchAccounts()
    },
    [accounts, fetchAccounts],
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

  return { accounts, loading, error, addAccount, deleteAccount, moveAccount, refetch: fetchAccounts }
}
