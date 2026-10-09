import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  createConversation,
  getMessages,
  getModels,
  isAbortError,
  listConversations,
  streamChat,
  type ConversationSummary,
} from './api'
import ChatWindow, { type ChatMessage } from './components/ChatWindow'
import Sidebar from './components/Sidebar'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Une erreur est survenue.'
}

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryText, setRetryText] = useState<string | null>(null) // message to resend after a failure
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // On startup, load the history and open the most recent conversation.
  useEffect(() => {
    listConversations()
      .then((list) => {
        setConversations(list)
        if (list.length > 0) setActiveId(list[0].id)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  // The list of allowed models comes from the server; the first one is the default.
  useEffect(() => {
    getModels()
      .then((list) => {
        setModels(list)
        setModel(list[0] ?? '')
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  // Load the messages whenever another conversation is opened.
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    getMessages(activeId)
      .then((list) => {
        if (!cancelled) setMessages(list.map(({ role, content }) => ({ role, content })))
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [activeId])

  function selectConversation(id: number) {
    if (loading || id === activeId) return
    setError(null)
    setRetryText(null)
    setDraft('')
    setMessages([])
    setActiveId(id)
  }

  async function handleNew() {
    if (loading) return
    setError(null)
    setRetryText(null)
    try {
      const id = await createConversation()
      setConversations((list) => [
        { id, created_at: new Date().toISOString(), preview: null },
        ...list,
      ])
      setDraft('')
      setMessages([])
      setActiveId(id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleSend(override?: string) {
    if (activeId === null || loading) return
    const text = (override ?? draft).trim()
    if (!text) return

    const base = messages.length // the user bubble goes at `base`, the assistant bubble at `base + 1`
    const isFirstMessage = base === 0
    setError(null)
    setRetryText(null)
    setDraft('')
    setMessages((list) => [...list, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller
    let received = ''
    // "as ... | null": the callback below assigns these, TypeScript can't see it.
    let failed = null as string | null
    let aborted = false

    const updateAssistant = (patch: (m: ChatMessage) => ChatMessage) =>
      setMessages((list) => list.map((m, i) => (i === base + 1 ? patch(m) : m)))

    try {
      await streamChat(
        { conversationId: activeId, message: text, model },
        (event) => {
          switch (event.type) {
            case 'delta':
              received += event.content
              updateAssistant((m) => ({ ...m, content: m.content + event.content }))
              break
            case 'quiz':
              setMessages((list) => [...list, { role: 'quiz', content: event.content }])
              break
            case 'notification':
              setMessages((list) => [...list, { role: 'system-notification', content: event.content }])
              break
            case 'done':
              updateAssistant((m) => ({ ...m, usage: event.usage }))
              break
            case 'error':
              failed = "La réponse a échoué : rien n'a été enregistré."
              break
          }
        },
        controller.signal,
      )
    } catch (err) {
      if (isAbortError(err)) aborted = true
      else failed = errorMessage(err) // HTTP error (400 unknown model, 404...) or server unreachable
    }

    abortRef.current = null

    if (failed !== null || (aborted && !received.trim())) {
      // The backend saved nothing for this turn: remove the optimistic bubbles and give the text back.
      setMessages((list) => list.slice(0, base))
      setDraft(text)
      if (failed !== null) {
        setError(failed)
        setRetryText(text)
      }
      setLoading(false)
      return
    }

    // Success, or Stop after some text arrived (the backend keeps the partial reply).
    if (aborted) updateAssistant((m) => ({ ...m, stopped: true }))
    setLoading(false)
    // The first message becomes the conversation's preview in the sidebar.
    if (isFirstMessage) listConversations().then(setConversations).catch(() => {})
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={handleNew}
      />
      <main className="main">
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <span className="error-actions">
              {retryText && (
                <button className="retry" onClick={() => handleSend(retryText)} disabled={loading}>
                  Réessayer
                </button>
              )}
              <button onClick={() => setError(null)} aria-label="Fermer">
                ×
              </button>
            </span>
          </div>
        )}
        {activeId === null ? (
          <div className="empty">
            <p>Aucune conversation ouverte.</p>
            <button className="new-button" onClick={handleNew}>
              + Nouvelle conversation
            </button>
          </div>
        ) : (
          <ChatWindow
            messages={messages}
            loading={loading}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => handleSend()}
            onStop={handleStop}
            models={models}
            model={model}
            onModelChange={setModel}
          />
        )}
      </main>
    </div>
  )
}