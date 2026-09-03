import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_USAGE, sumUsage } from '../lib/aiUsagePricing'

const TITLE_MAX_CHARS = 60

function deriveTitle(text) {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > TITLE_MAX_CHARS ? `${trimmed.slice(0, TITLE_MAX_CHARS)}…` : trimmed
}

function sortByUpdatedDesc(list) {
  return [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
}

// Persists conversations/messages to ai_conversations/ai_messages (both
// authenticated-only RLS, same as every other personal-data table in this
// app) so a conversation survives navigating away from the page, a refresh,
// or coming back tomorrow — not just kept alive in memory for the current
// mount, which is what this used to do. On mount, resumes whichever
// conversation was most recently active; "New Conversation" starts a fresh
// one (lazily created in the DB on its first message, so switching to a new
// conversation and never sending anything leaves no empty row behind).
//
// portfolioContext is computed once by the caller (see AiCompanionPage) and
// resent verbatim on every turn — the same JSON string each time is what
// lets the Edge Function's cache_control breakpoint on it actually hit
// after the first message, not just a token-count optimization.
export function useAiCompanion(portfolioContext) {
  const [messages, setMessages] = useState([])
  const [conversationId, setConversationId] = useState(null)
  const [conversations, setConversations] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  // Running total for the current conversation only, reset on switching —
  // see TokenUsageModal for how this pairs with ai_usage_log's all-time total.
  const [sessionUsage, setSessionUsage] = useState(EMPTY_USAGE)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data, error: listError } = await supabase
        .from('ai_conversations')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false })
      if (cancelled) return

      if (listError) {
        setError(listError.message)
        setLoadingHistory(false)
        return
      }

      setConversations(data ?? [])
      if (data?.length) {
        const { data: msgs, error: msgsError } = await supabase
          .from('ai_messages')
          .select('role, content')
          .eq('conversation_id', data[0].id)
          .order('created_at', { ascending: true })
        if (cancelled) return
        if (!msgsError) {
          setConversationId(data[0].id)
          setMessages((msgs ?? []).map((m) => ({ role: m.role, content: m.content })))
        }
      }
      setLoadingHistory(false)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [])

  const loadConversation = useCallback(async (id) => {
    setError(null)
    const { data, error: msgsError } = await supabase
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    if (msgsError) {
      setError(msgsError.message)
      return
    }
    setConversationId(id)
    setMessages((data ?? []).map((m) => ({ role: m.role, content: m.content })))
    setSessionUsage(EMPTY_USAGE)
  }, [])

  const sendMessage = useCallback(
    async (content) => {
      const trimmed = content.trim()
      if (!trimmed) return

      const nextMessages = [...messages, { role: 'user', content: trimmed }]
      setMessages(nextMessages)
      setSending(true)
      setError(null)

      try {
        let convId = conversationId
        if (!convId) {
          const { data: convo, error: convoError } = await supabase
            .from('ai_conversations')
            .insert({ title: deriveTitle(trimmed) })
            .select('id, title, updated_at')
            .single()
          if (convoError) throw convoError
          convId = convo.id
          setConversationId(convId)
          setConversations((prev) => sortByUpdatedDesc([convo, ...prev]))
        }

        const { error: userInsertError } = await supabase
          .from('ai_messages')
          .insert({ conversation_id: convId, role: 'user', content: trimmed })
        if (userInsertError) throw userInsertError

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

        const updatedAt = new Date().toISOString()
        await supabase.from('ai_messages').insert({ conversation_id: convId, role: 'assistant', content: data.reply })
        await supabase.from('ai_conversations').update({ updated_at: updatedAt }).eq('id', convId)
        setConversations((prev) =>
          sortByUpdatedDesc(prev.map((c) => (c.id === convId ? { ...c, updated_at: updatedAt } : c))),
        )
      } catch (err) {
        setError(err.message)
      } finally {
        setSending(false)
      }
    },
    [messages, conversationId, portfolioContext],
  )

  const clearConversation = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setError(null)
    setSessionUsage(EMPTY_USAGE)
  }, [])

  return {
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
  }
}
