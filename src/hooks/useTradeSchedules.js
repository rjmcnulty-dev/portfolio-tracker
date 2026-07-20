import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useTradeSchedules(account = 'All') {
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchSchedules = useCallback(async () => {
    setLoading(true)

    let query = supabase.from('trade_schedules').select('*').order('start_date', { ascending: false })
    if (account !== 'All') {
      query = query.eq('account', account)
    }

    const { data, error: fetchError } = await query

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
      const { error: insertError } = await supabase.from('trade_schedules').insert(schedule)
      if (insertError) throw insertError
      await fetchSchedules()
    },
    [fetchSchedules],
  )

  const updateSchedule = useCallback(
    async (id, updates) => {
      const { error: updateError } = await supabase.from('trade_schedules').update(updates).eq('id', id)
      if (updateError) throw updateError
      await fetchSchedules()
    },
    [fetchSchedules],
  )

  const deleteSchedule = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from('trade_schedules').delete().eq('id', id)
      if (deleteError) throw deleteError
      await fetchSchedules()
    },
    [fetchSchedules],
  )

  const materializeNow = useCallback(async () => {
    const { data, error: invokeError } = await supabase.functions.invoke('materialize-trades')
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
