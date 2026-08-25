import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// CRUD for the benchmarks table (Portfolio Performance chart's comparison
// indexes) — used by both AdminBenchmarksPage (manage the list) and
// BenchmarkComparisonChart (read the list). Unlike trade_types, no row is
// core/protected and there's no in-use guard on delete — nothing else in the
// app's calculation logic depends on any specific benchmark ticker existing,
// see "Benchmarks" in the README.
export function useBenchmarks() {
  const [benchmarks, setBenchmarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchBenchmarks = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase.from('benchmarks').select('*').order('sort_order', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setBenchmarks(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchBenchmarks()
  }, [fetchBenchmarks])

  const addBenchmark = useCallback(
    async (ticker, name, color) => {
      const trimmedTicker = ticker.trim().toUpperCase()
      const trimmedName = name.trim()
      if (!trimmedTicker) throw new Error('Ticker is required')
      if (!trimmedName) throw new Error('Name is required')

      // Append at the end of the current order, same reasoning as
      // useAccounts.addAccount — the column default (0) would otherwise put
      // every new benchmark first.
      const { data: last, error: lastError } = await supabase
        .from('benchmarks')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastError) throw lastError
      const nextOrder = (last?.sort_order ?? -1) + 1

      const { error: insertError } = await supabase
        .from('benchmarks')
        .insert({ ticker: trimmedTicker, name: trimmedName, color, sort_order: nextOrder })
      if (insertError) {
        throw insertError.code === '23505' ? new Error(`"${trimmedTicker}" is already a benchmark.`) : insertError
      }
      await fetchBenchmarks()
      return trimmedTicker
    },
    [fetchBenchmarks],
  )

  const updateBenchmark = useCallback(
    async (ticker, { name, color }) => {
      const { error: updateError } = await supabase.from('benchmarks').update({ name, color }).eq('ticker', ticker)
      if (updateError) throw updateError
      await fetchBenchmarks()
    },
    [fetchBenchmarks],
  )

  // Swaps sort_order with the adjacent benchmark, same single-transposition
  // approach as useAccounts.moveAccount.
  const moveBenchmark = useCallback(
    async (ticker, direction) => {
      const index = benchmarks.findIndex((b) => b.ticker === ticker)
      if (index === -1) return
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= benchmarks.length) return

      const current = benchmarks[index]
      const neighbor = benchmarks[swapIndex]

      const [{ error: errorA }, { error: errorB }] = await Promise.all([
        supabase.from('benchmarks').update({ sort_order: neighbor.sort_order }).eq('ticker', current.ticker),
        supabase.from('benchmarks').update({ sort_order: current.sort_order }).eq('ticker', neighbor.ticker),
      ])
      if (errorA) throw errorA
      if (errorB) throw errorB

      await fetchBenchmarks()
    },
    [benchmarks, fetchBenchmarks],
  )

  const deleteBenchmark = useCallback(
    async (ticker) => {
      const { error: deleteError } = await supabase.from('benchmarks').delete().eq('ticker', ticker)
      if (deleteError) throw deleteError
      await fetchBenchmarks()
    },
    [fetchBenchmarks],
  )

  return {
    benchmarks,
    loading,
    error,
    addBenchmark,
    updateBenchmark,
    moveBenchmark,
    deleteBenchmark,
    refetch: fetchBenchmarks,
  }
}
