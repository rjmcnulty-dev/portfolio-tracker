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

  return { accounts, loading, error, addAccount, refetch: fetchAccounts }
}
