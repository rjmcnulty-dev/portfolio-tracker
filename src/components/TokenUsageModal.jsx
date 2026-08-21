import { useConfigValue } from '../hooks/useAppConfig'
import { useAiUsageTotal } from '../hooks/useAiUsageTotal'
import { estimateCost } from '../lib/aiUsagePricing'
import './TokenUsageModal.css'

// $/million-token rates matching Anthropic's published Sonnet pricing as of
// when this was built, plus the flat per-search web search fee (billed
// separately from tokens) — editable from /admin -> App Settings -> AI
// Companion (ai_companion_pricing) if rates change or the model does.
const DEFAULT_PRICING = {
  inputPerMTok: 3,
  outputPerMTok: 15,
  cacheWritePerMTok: 3.75,
  cacheReadPerMTok: 0.3,
  webSearchPerSearch: 0.01,
}

function formatTokens(value) {
  return (value ?? 0).toLocaleString('en-US')
}

function formatCost(value) {
  if (value > 0 && value < 0.0001) return '<$0.0001'
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function UsageSection({ title, usage, pricing, loading, error }) {
  return (
    <div className="token-usage__section">
      <h3 className="token-usage__section-title">{title}</h3>
      {loading ? (
        <p className="page__loading">Loading…</p>
      ) : error ? (
        <p className="page__error">Error: {error}</p>
      ) : (
        <>
          <table className="token-usage__table">
            <tbody>
              <tr>
                <td>Input tokens</td>
                <td className="is-numeric">{formatTokens(usage.input_tokens)}</td>
              </tr>
              <tr>
                <td>Output tokens</td>
                <td className="is-numeric">{formatTokens(usage.output_tokens)}</td>
              </tr>
              <tr>
                <td>Cache write tokens</td>
                <td className="is-numeric">{formatTokens(usage.cache_creation_input_tokens)}</td>
              </tr>
              <tr>
                <td>Cache read tokens</td>
                <td className="is-numeric">{formatTokens(usage.cache_read_input_tokens)}</td>
              </tr>
              <tr>
                <td>Web searches</td>
                <td className="is-numeric">{formatTokens(usage.web_search_requests)}</td>
              </tr>
            </tbody>
          </table>
          <p className="token-usage__cost">
            Estimated spend: <strong>{formatCost(estimateCost(usage, pricing))}</strong>
          </p>
        </>
      )}
    </div>
  )
}

export default function TokenUsageModal({ sessionUsage, onClose }) {
  const pricing = useConfigValue('ai_companion_pricing', DEFAULT_PRICING)
  const { usage: totalUsage, loading: totalLoading, error: totalError } = useAiUsageTotal()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">Token Usage</h2>
        <p className="page__hint">
          Estimated from token counts using configurable per-token rates — not pulled from Anthropic's actual
          billing, so treat this as an approximation, not an invoice.
        </p>

        <UsageSection title="This Session" usage={sessionUsage} pricing={pricing} />
        <UsageSection title="All Time" usage={totalUsage} pricing={pricing} loading={totalLoading} error={totalError} />

        <div className="trade-form__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
