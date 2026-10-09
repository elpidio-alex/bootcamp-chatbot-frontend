// Thin typed wrappers around the FastAPI backend (proxied under /api by Vite).
// En local, le proxy de Vite sert /api. En production, VITE_API_URL contient l'adresse publique du backend.
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'
export type Role = 'user' | 'assistant' | 'system-notification' | 'quiz'

export interface ConversationSummary {
  id: number
  created_at: string
  preview: string | null
}

export interface Message {
  seq: number
  role: Role
  content: string
  created_at: string
}

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// Events sent by POST /chat, one per "data: {...}" block.
export type ChatEvent =
  | { type: 'delta'; content: string }
  | { type: 'quiz'; content: string }
  | { type: 'notification'; content: string }
  | { type: 'done'; usage: Usage | null }
  | { type: 'error'; message: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('Impossible de joindre le serveur.')
  }
  if (!response.ok) {
    // FastAPI errors look like {"detail": "..."}.
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : null
    throw new Error(detail ?? `Erreur ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request('/conversations')
}

export async function createConversation(): Promise<number> {
  const { conversation_id } = await request<{ conversation_id: number }>('/conversations', {
    method: 'POST',
  })
  return conversation_id
}

export function getMessages(conversationId: number): Promise<Message[]> {
  return request(`/conversations/${conversationId}/messages`)
}

export function getModels(): Promise<string[]> {
  return request('/models')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

// Sends a message and reads the streamed reply. fetch + getReader because EventSource can't POST.
// Resolves once the stream is over; rejects with an AbortError if `signal` is aborted (Stop button),
// or with an Error for HTTP errors (400 unknown model, 404...) and network failures.
export async function streamChat(
  params: { conversationId: number; message: string; model: string },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('${API_BASE}/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: params.conversationId,
        message: params.message,
        model: params.model,
      }),
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new Error('Impossible de joindre le serveur.')
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : null
    throw new Error(detail ?? `Erreur ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false // true once we got a "done" or an "error" event

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Events are separated by a blank line; keep the unfinished tail for the next read.
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const line = block.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const event = JSON.parse(line.slice('data:'.length).trim()) as ChatEvent
        if (event.type === 'done' || event.type === 'error') finished = true
        onEvent(event)
      }
    }
  } catch (error) {
    if (isAbortError(error)) throw error
    onEvent({ type: 'error', message: 'Connexion interrompue.' })
    return
  }

  // The stream closed without a final event (server crash, network cut): treat it as an error.
  if (!finished) onEvent({ type: 'error', message: 'Connexion interrompue.' })
}