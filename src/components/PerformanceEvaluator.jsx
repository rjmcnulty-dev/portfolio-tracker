import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePriceTargets } from '../hooks/usePriceTargets'
import { evaluatePosition } from '../lib/performanceEvaluator'
import './PerformanceEvaluator.css'

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num) || value == null) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function pctClass(value) {
  if (value == null) return ''
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : ''
}

export default function PerformanceEvaluator({ holdings, title, onClose }) {
  const { targets } = usePriceTargets()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(null)
  const [errors, setErrors] = useState({})
  const [runError, setRunError] = useState(null)

  async function handleRun() {
    setRunning(true)
    setRunError(null)
    try {
      const tickers = holdings.map((h) => h.ticker)
      const { data, error } = await supabase.functions.invoke('evaluate-performance', { body: { tickers } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setResults(data.results ?? {})
      setErrors(data.errors ?? {})
    } catch (err) {
      setRunError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const rows = holdings
    .map((holding) => {
      const data = results?.[holding.ticker]
      if (!data) return null
      const targetPrice = targets[holding.ticker]?.target_price ?? null
      const evaluation = evaluatePosition({
        currentPrice: data.currentPrice,
        targetPrice,
        sma20: data.sma20,
        sma50: data.sma50,
        sma200: data.sma200,
        support: data.support,
        resistance: data.resistance,
      })
      return { ticker: holding.ticker, ...data, targetPrice, ...evaluation }
    })
    .filter(Boolean)

  const estimatedMinutes = Math.ceil(holdings.length / 8) - 1

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal performance-evaluator" onClick={(event) => event.stopPropagation()}>
        <div className="performance-evaluator__header">
          <h2 className="modal__title">Performance Evaluator{title ? ` — ${title}` : ''}</h2>
          <button className="btn-link" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="performance-evaluator__disclaimer">
          A rule of thumb combining your price targets with SMA20/50/200 trend and support/resistance — not
          investment advice.
        </p>

        {!holdings.length ? (
          <p className="performance-evaluator__empty">No open positions to evaluate.</p>
        ) : !results && !running ? (
          <div className="performance-evaluator__intro">
            <p>
              Evaluates {holdings.length} held ticker{holdings.length === 1 ? '' : 's'} over 1/3/6/12 months.
            </p>
            {estimatedMinutes > 0 && (
              <p className="trade-form__hint">
                More than 8 tickers — this will take about {estimatedMinutes + 1} minute
                {estimatedMinutes + 1 === 1 ? '' : 's'} due to API rate limits.
              </p>
            )}
            <button className="btn btn--primary" onClick={handleRun}>
              Run Evaluation
            </button>
          </div>
        ) : running ? (
          <p className="performance-evaluator__loading">Evaluating… this can take a minute for larger portfolios.</p>
        ) : null}

        {runError && <p className="trade-form__error">{runError}</p>}

        {results && !running && (
          <>
            <div className="performance-evaluator__table-wrap">
              <table className="performance-evaluator__table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th className="is-numeric">Price</th>
                    <th className="is-numeric">Target</th>
                    <th className="is-numeric">Upside</th>
                    <th className="is-numeric">1mo</th>
                    <th className="is-numeric">3mo</th>
                    <th className="is-numeric">6mo</th>
                    <th className="is-numeric">12mo</th>
                    <th>Trend</th>
                    <th>Suggestion</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ticker}>
                      <td className="performance-evaluator__ticker">{row.ticker}</td>
                      <td className="is-numeric">{formatCurrency(row.currentPrice)}</td>
                      <td className="is-numeric">{formatCurrency(row.targetPrice)}</td>
                      <td className={`is-numeric ${pctClass(row.upsidePct)}`}>{formatPct(row.upsidePct)}</td>
                      <td className={`is-numeric ${pctClass(row.returns?.['1m'])}`}>{formatPct(row.returns?.['1m'])}</td>
                      <td className={`is-numeric ${pctClass(row.returns?.['3m'])}`}>{formatPct(row.returns?.['3m'])}</td>
                      <td className={`is-numeric ${pctClass(row.returns?.['6m'])}`}>{formatPct(row.returns?.['6m'])}</td>
                      <td className={`is-numeric ${pctClass(row.returns?.['12m'])}`}>{formatPct(row.returns?.['12m'])}</td>
                      <td>{row.trend}</td>
                      <td>
                        <span
                          className={`performance-evaluator__badge performance-evaluator__badge--${row.suggestion.toLowerCase()}`}
                          title={row.reasons.join('; ')}
                        >
                          {row.suggestion}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.entries(errors).map(([ticker, message]) => (
              <p key={ticker} className="trade-form__error">
                {ticker}: {message}
              </p>
            ))}
            <div className="performance-evaluator__actions">
              <button className="btn btn--ghost" disabled={running} onClick={handleRun}>
                Re-run
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
