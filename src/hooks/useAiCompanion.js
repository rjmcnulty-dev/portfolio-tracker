import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_USAGE, sumUsage } from '../lib/aiUsagePricing'

// Ephemeral, in-memory conversation — resets on refresh. Persisting chat
// history to a table is a deliberate fast-follow, not done here, since
// nothing about this MVP needs a conversation to survive a reload.
//
// portfolioContext is computed once by the caller (see AiCompanionPage) and
// resent verbatim on every turn — the same JSON string each time is what
// lets the Edge Function's cache_control breakpoint on it actually hit
// after the first message, not just a token-count optimization.
export function useAiCompanion(portfolioContext) {
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  // Running total for the current conversation only — see TokenUsageModal
  // for how this pairs with ai_usage_log's all-time total.
  const [sessionUsage, setSessionUsage] = useState(EMPTY_USAGE)

  const sendMessage = useCallback(
    async (content) => {
      const trimmed = content.trim()
      if (!trimmed) return

      const nextMessages = [...messages, { role: 'user', content: trimmed }]
      setMessages(nextMessages)
      setSending(true)
      setError(null)

      try {
        const { data, error: invokeError } = await supabase.functions.invoke('ai-companion', {
          body: { messages: nextMessages, portfolioContext },
        })
        if (invokeError) throw invokeError
        if (data?.error) throw new Error(data.error)

        if (data.usage) {
          console.debug('[ai-companion] usage', data.usage)
          setSessionUsage((prev) => sumUsage(prev, data.usage))
        }

        setMessages([...nextMessages, { role: 'assistant', content: data.reply }])
      } catch (err) {
        setError(err.message)
      } finally {
        setSending(false)
      }
    },
    [messages, portfolioContext],
  )

  const clearConversation = useCallback(() => {
    setMessages([])
    setError(null)
    setSessionUsage(EMPTY_USAGE)
  }, [])

  return { messages, sending, error, sendMessage, clearConversation, sessionUsage }
}
