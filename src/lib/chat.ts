import { loggedFetch } from './debug.svelte'
import { effectiveApiKey } from './api-key.svelte'

// Chat layer: a "larger" LLM that the user can talk to. Its reply is printed
// in the transcript AND fed back into the emotion pipeline (src/lib/emotion.ts),
// so the avatar reacts to what Jev says — not just to what the user types.

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini'
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

// Keep context small and cheap: only the most recent turns are sent.
const MAX_HISTORY = 20

// Jev persona: short, emotionally vivid replies classify better through the
// emotion pipeline, and they keep the avatar's reaction readable. No emojis:
// replies are read aloud (src/lib/voice.svelte.ts) and screen readers would
// announce every glyph — the emotion must live in the wording.
const SYSTEM_PROMPT = [
  'You are Jev, a friendly cartoon character with big expressive reactions.',
  'Reply in 1-3 short sentences. Be warm, playful and emotionally vivid —',
  'let your feelings show in your wording so your mood is easy to read.',
  'Never use emojis or emoticons — express emotion through words only.',
  'Always answer in the same language the user wrote in.',
].join(' ')

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export async function sendChatMessage(history: ChatMessage[]): Promise<string> {
  const apiKey = effectiveApiKey()
  if (!apiKey) {
    throw new Error('MISSING_KEY')
  }

  const model = import.meta.env.VITE_CHAT_MODEL || DEFAULT_MODEL

  // POST request hitting the OpenRouter chat completions endpoint, logged to
  // the debug console like every other LLM call.
  const response = await loggedFetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-MAX_HISTORY),
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`)
  }

  const data: ChatCompletionResponse = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('INVALID_RESPONSE')
  }

  return content
}
