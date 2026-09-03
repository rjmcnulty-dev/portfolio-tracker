import { useEffect, useRef, useState } from 'react'
import { usePortfolio } from '../hooks/usePortfolio'
import { useAiCompanion } from '../hooks/useAiCompanion'
import { buildPortfolioContext } from '../lib/portfolioContext'
import TokenUsageModal from '../components/TokenUsageModal'
import './AiCompanionPage.css'

export default function AiCompanionPage() {
  const { kpis, holdings, allocation, cashPosition, trades, loading: portfolioLoading } = usePortfolio('All')
  // Frozen the first time portfolio data finishes loading, not recomputed on
  // every render — see useAiCompanion/portfolioContext.js for why a stable
  // JSON string across the whole conversation matters for prompt caching,
  // not just correctness.
  const portfolioContextRef = useRef(null)
  if (!portfolioLoading && !portfolioContextRef.current) {
    portfolioContextRef.current = buildPortfolioContext({ kpis, holdings, allocation, cashPosition, trades })
  }

  const {
    messages,
    sending,
    error,
    sendMessage,
    clearConversation,
    sessionUsage,
    conversations,
    conversationId,
    loadConversation,
    loadingHistory,
  } = useAiCompanion(portfolioContextRef.current)
  const [draft, setDraft] = useState('')
  const [showUsageModal, setShowUsageModal] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const listRef = useRef(null)
  const historyRef = useRef(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!historyOpen) return
    function handleClickOutside(event) {
      if (historyRef.current && !historyRef.current.contains(event.target)) setHistoryOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [historyOpen])

  function handleSubmit(event) {
    event.preventDefault()
    if (!draft.trim() || sending) return
    sendMessage(draft)
    setDraft('')
  }

  function handleSelectConversation(id) {
    setHistoryOpen(false)
    if (id !== conversationId) loadConversation(id)
  }

  return (
    <div className="page">
      <header className="page__header page__header--row">
        <div>
          <h1>AI Companion</h1>
          <p className="page__subtitle">
            Chat with Claude — it has a snapshot of your current holdings, P&amp;L, cash position, and trades from
            the last 60 days, as of when this page loaded.
          </p>
        </div>
        <div className="filters">
          <div className="ai-companion__history" ref={historyRef}>
            <button
              className="btn btn--ghost"
              disabled={sending}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              History{conversations.length > 0 ? ` (${conversations.length})` : ''}
            </button>
            {historyOpen && (
              <div className="ai-companion__history-menu">
                {conversations.length === 0 ? (
                  <p className="ai-companion__history-empty">No past conversations yet.</p>
                ) : (
                  conversations.map((c) => (
                    <button
                      key={c.id}
                      className={`ai-companion__history-item ${c.id === conversationId ? 'is-active' : ''}`}
                      onClick={() => handleSelectConversation(c.id)}
                    >
                      <span className="ai-companion__history-item-title">{c.title}</span>
                      <span className="ai-companion__history-item-date">
                        {new Date(c.updated_at).toLocaleString()}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button className="btn btn--ghost" onClick={() => setShowUsageModal(true)}>
            Token Usage
          </button>
          {messages.length > 0 && (
            <button className="btn btn--ghost" onClick={clearConversation}>
              New Conversation
            </button>
          )}
        </div>
      </header>

      <div className="ai-companion">
        <div className="ai-companion__messages" ref={listRef}>
          {loadingHistory ? (
            <p className="ai-companion__empty">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="ai-companion__empty">Ask it anything to get started.</p>
          ) : (
            messages.map((message, index) => (
              <div key={index} className={`ai-companion__bubble ai-companion__bubble--${message.role}`}>
                {message.content}
              </div>
            ))
          )}
          {sending && (
            <div className="ai-companion__bubble ai-companion__bubble--assistant ai-companion__bubble--thinking">
              Thinking…
            </div>
          )}
        </div>

        {error && <p className="page__error">{error}</p>}

        <form className="ai-companion__input-row" onSubmit={handleSubmit}>
          <textarea
            placeholder="Message the AI Companion… (Enter to send, Shift+Enter for a new line)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
            disabled={sending}
          />
          <button className="btn btn--primary" type="submit" disabled={sending || !draft.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>

      {showUsageModal && <TokenUsageModal sessionUsage={sessionUsage} onClose={() => setShowUsageModal(false)} />}
    </div>
  )
}
