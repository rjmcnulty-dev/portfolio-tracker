import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './RothProgress.css'

const CURRENT_YEAR = new Date().getFullYear()
const PLAN_YEARS = [CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR]

function formatCurrency(value) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function RothProgress() {
  const [conversions, setConversions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('roth_conversions')
        .select('*')
        .gte('year', PLAN_YEARS[0])
        .order('year', { ascending: true })

      if (!ignore) {
        if (fetchError) setError(fetchError.message)
        else setConversions(data ?? [])
        setLoading(false)
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  if (loading) return <div className="roth-card">Loading Roth conversion progress…</div>
  if (error) return <div className="roth-card">Error: {error}</div>

  const byYear = PLAN_YEARS.map((year) => {
    const rows = conversions.filter((c) => c.year === year)
    const amount = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    const goal = rows.reduce((max, r) => Math.max(max, Number(r.goal_amount) || 0), 0)
    return { year, amount, goal }
  })

  const totalAmount = byYear.reduce((sum, y) => sum + y.amount, 0)
  const totalGoal = byYear.reduce((sum, y) => sum + y.goal, 0)
  const overallPct = totalGoal > 0 ? Math.min(100, (totalAmount / totalGoal) * 100) : 0

  return (
    <div className="roth-card">
      <h3 className="roth-card__title">4-Year Roth Conversion Plan</h3>
      <div className="roth-card__overall">
        <div className="roth-progress-bar">
          <div className="roth-progress-bar__fill" style={{ width: `${overallPct}%` }} />
        </div>
        <span className="roth-card__overall-label">
          {formatCurrency(totalAmount)} of {formatCurrency(totalGoal)} ({overallPct.toFixed(0)}%)
        </span>
      </div>

      <ul className="roth-year-list">
        {byYear.map((y) => {
          const pct = y.goal > 0 ? Math.min(100, (y.amount / y.goal) * 100) : 0
          return (
            <li key={y.year} className="roth-year-row">
              <span className="roth-year-row__year">{y.year}</span>
              <div className="roth-progress-bar roth-progress-bar--small">
                <div className="roth-progress-bar__fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="roth-year-row__amount">
                {formatCurrency(y.amount)} / {formatCurrency(y.goal)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
