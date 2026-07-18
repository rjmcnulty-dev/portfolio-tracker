import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useDeposits(account = 'All') {
  const [deposits, setDeposits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchDeposits = useCallback(async () => {
    setLoading(true)

    let query = supabase.from('deposits').select('*').order('deposit_date', { ascending: false })
    if (account !== 'All') {
      query = query.eq('account', account)
    }

    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setDeposits(data ?? [])
    }
    setLoading(false)
  }, [account])

  useEffect(() => {
    fetchDeposits()
  }, [fetchDeposits])

  const addDeposit = useCallback(
    async (deposit) => {
      const { error: insertError } = await supabase.from('deposits').insert(deposit)
      if (insertError) throw insertError
      await fetchDeposits()
    },
    [fetchDeposits],
  )

  const updateDeposit = useCallback(
    async (id, updates) => {
      const { error: updateError } = await supabase.from('deposits').update(updates).eq('id', id)
      if (updateError) throw updateError
      await fetchDeposits()
    },
    [fetchDeposits],
  )

  const deleteDeposit = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from('deposits').delete().eq('id', id)
      if (deleteError) throw deleteError
      await fetchDeposits()
    },
    [fetchDeposits],
  )

  return { deposits, loading, error, addDeposit, updateDeposit, deleteDeposit, refetch: fetchDeposits }
}
