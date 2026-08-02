import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useDepositSchedules(account = 'All') {
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Guards against out-of-order responses — see useDeposits.js for why this
  // matters (a slower, stale request for a different account can otherwise
  // resolve last and silently overwrite correct data).
  const latestRequestId = useRef(0)

  const fetchSchedules = useCallback(async () => {
    const requestId = ++latestRequestId.current
    setLoading(true)

    let query = supabase.from('deposit_schedules').select('*').order('start_date', { ascending: false })
    if (account !== 'All') {
      query = query.eq('account', account)
    }

    const { data, error: fetchError } = await query

    if (requestId !== latestRequestId.current) return

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setSchedules(data ?? [])
    }
    setLoading(false)
  }, [account])

  useEffect(() => {
    fetchSchedules()
  }, [fetchSchedules])

  const addSchedule = useCallback(
    async (schedule) => {
      const { error: insertError } = await supabase.from('deposit_schedules').insert(schedule)
      if (insertError) throw insertError
      await fetchSchedules()
    },
    [fetchSchedules],
  )

  const updateSchedule = useCallback(
    async (id, updates) => {
      const { error: updateError } = await supabase.from('deposit_schedules').update(updates).eq('id', id)
      if (updateError) throw updateError
      await fetchSchedules()
    },
    [fetchSchedules],
  )

  const deleteSchedule = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from('deposit_schedules').delete().eq('id', id)
      if (deleteError) throw deleteError
      await fetchSchedules()
    },
    [fetchSchedules],
  )

  const materializeNow = useCallback(async () => {
    const { data, error: invokeError } = await supabase.functions.invoke('materialize-deposits')
    if (invokeError) throw invokeError
    if (data?.error) throw new Error(data.error)
    await fetchSchedules()
    return data
  }, [fetchSchedules])

  return {
    schedules,
    loading,
    error,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    materializeNow,
    refetch: fetchSchedules,
  }
}
