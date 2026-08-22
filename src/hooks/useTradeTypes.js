import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Live fetch of the trade_types table — used directly by the New/Edit Trade
// dropdown and by /admin's Trade Types manager, so both reflect a just-added
// custom type without a page reload. Layout.jsx separately feeds this same
// data into src/lib/tradeTypes.js's module-level cache, which is what the
// calculation code (usePortfolio, useDailyGains, etc.) actually reads from —
// see that file for why those call sites don't use this hook directly.
export function useTradeTypes() {
  const [tradeTypes, setTradeTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchTradeTypes = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase.from('trade_types').select('*').order('value')

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setTradeTypes(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTradeTypes()
  }, [fetchTradeTypes])

  const addTradeType = useCallback(
    async (value, deductsCash) => {
      const trimmed = value.trim()
      if (!trimmed) throw new Error('Trade type name is required')

      const { error: insertError } = await supabase
        .from('trade_types')
        .insert({ value: trimmed, is_core: false, deducts_cash: deductsCash })
      if (insertError) throw insertError
      await fetchTradeTypes()
    },
    [fetchTradeTypes],
  )

  const updateTradeType = useCallback(
    async (value, deductsCash) => {
      // .eq('is_core', false) is a second line of defense, not the only
      // check — see AdminTradeTypesPage, which never renders an edit
      // control for a core row in the first place.
      const { error: updateError } = await supabase
        .from('trade_types')
        .update({ deducts_cash: deductsCash })
        .eq('value', value)
        .eq('is_core', false)
      if (updateError) throw updateError
      await fetchTradeTypes()
    },
    [fetchTradeTypes],
  )

  const deleteTradeType = useCallback(
    async (value) => {
      const current = tradeTypes.find((t) => t.value === value)
      if (current?.is_core) {
        throw new Error(`"${value}" is a core trade type and can't be deleted.`)
      }

      // trades.trade_type isn't a real foreign key (matches how account
      // deletion already checks for in-use rows by hand — see
      // useAccounts.js's deleteAccount) — check first so a raw constraint
      // error isn't the only feedback, and so orphaned trades can never
      // happen even without one.
      const { count, error: countError } = await supabase
        .from('trades')
        .select('id', { count: 'exact', head: true })
        .eq('trade_type', value)
      if (countError) throw countError
      if (count) {
        throw new Error(`Can't delete — ${count} trade${count === 1 ? '' : 's'} still use${count === 1 ? 's' : ''} "${value}".`)
      }

      const { error: deleteError } = await supabase.from('trade_types').delete().eq('value', value).eq('is_core', false)
      if (deleteError) throw deleteError
      await fetchTradeTypes()
    },
    [tradeTypes, fetchTradeTypes],
  )

  return { tradeTypes, loading, error, addTradeType, updateTradeType, deleteTradeType, refetch: fetchTradeTypes }
}
