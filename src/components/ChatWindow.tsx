import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import type { Role, Usage } from '../api'

export interface ChatMessage {
  role: Role
  content: string
  usage?: Usage | null // tokens used by this reply (only known for replies received in this session)
  stopped?: boolean // the student pressed Stop: the reply is partial
}

interface ChatWindowProps {
  messages: ChatMessage[]
  loading: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  models: string[]
  model: string
  onModelChange: (value: string) => void
}

// "anthropic/claude-haiku-4-5-20251001" -> "claude-haiku-4-5-20251001"
function shortName(model: string): string {
  return model.split('/').pop() ?? model
}

export default function ChatWindow({
  messages,
  loading,
  draft,
  onDraftChange,
  onSend,
  onStop,
  models,
  model,
  onModelChange,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Keep the latest message in view (no smooth scrolling while the text is streaming: it would lag).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: loading ? 'auto' : 'smooth' })
  }, [messages, loading])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!loading && draft.trim() && model) onSend()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a new line.
    if (event.key === 'Enter' && !event.shiftKey) handleSubmit(event)
  }

  return (
    <section className="chat">
      <div className="messages">
        {messages.length === 0 && !loading && (
          <p className="muted center">Pose ta première question à Study Buddy.</p>
        )}
        {messages.map((m, i) =>
          m.role === 'system-notification' ? (
            <div key={i} className="notification">
              {m.content}
            </div>
          ) : (
            <div key={i} className={`bubble ${m.role}`}>
              {m.role === 'quiz' && <div className="bubble-label">Question de révision</div>}
              {/* Empty assistant bubble = the reply has not started to arrive yet. */}
              {m.role === 'assistant' && m.content === '' ? (
                <span className="typing">…</span>
              ) : m.role === 'user' ? (
                m.content
              ) : (
                <Markdown>{m.content}</Markdown>
              )}
              {m.stopped && <div className="bubble-meta">Réponse interrompue</div>}
              {m.usage && (
                <div className="bubble-meta">
                  {m.usage.total_tokens} tokens ({m.usage.prompt_tokens} envoyés,{' '}
                  {m.usage.completion_tokens} générés)
                </div>
              )}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="toolbar">
        <label>
          Modèle{' '}
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={loading || models.length === 0}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {shortName(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Écris ton message…"
          rows={2}
          disabled={loading}
          autoFocus
        />
        {loading ? (
          <button type="button" className="stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim() || !model}>
            Envoyer
          </button>
        )}
      </form>
    </section>
  )
}