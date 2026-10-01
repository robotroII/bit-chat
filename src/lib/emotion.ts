import { loggedFetch } from './debug.svelte'

// 1. Type contracts matching Jev's API layout
export type EmotionCategory =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'terrified'
  | 'curious'
  | 'suspicious'
  | 'neutral'

export type ToneSubtext = 'genuine' | 'sarcastic' | 'dramatic' | 'casual'

export interface ReactionResult {
  emotion: EmotionCategory
  tone: ToneSubtext
  intensity: number // 1-5
}

// Emotion→visual mapping lives in the pluggable renderers now
// (src/lib/reactions/), so analysis stays presentation-agnostic.

const MODEL = '~typesafe/jev-latest'
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'

interface DecisionResponse {
  answers?: {
    emotion?: { probabilities?: Record<string, number> }
    tone?: { probabilities?: Record<string, number> }
    intensity?: { score?: number }
  }
}

// Extract the highest-probability key from a probabilities map
function argMax(prob: Record<string, number> | undefined): string | undefined {
  if (!prob) return undefined
  return Object.keys(prob).reduce<string | undefined>(
    (a, b) => (a === undefined || prob[b] > prob[a] ? b : a),
    undefined,
  )
}

export async function evaluateComplexReaction(text: string): Promise<ReactionResult> {
  const apiKey = import.meta.env.VITE_OPENROUTER_KEY
  if (!apiKey) {
    throw new Error('MISSING_KEY')
  }

  // POST request hitting the Jev Decisions endpoint, logged to the debug console
  const response = await loggedFetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL, // Always target the latest Jev build
      state: text,
      // Speculative fan-out: multiple questions processed at the exact same time.
      // `criteria` maps each choice to a description the model scores against.
      questions: {
        emotion: {
          type: 'choice',
          criteria: {
            happy: 'the text expresses joy or positivity',
            sad: 'the text expresses sadness or grief',
            angry: 'the text expresses anger or fury',
            surprised: 'the text expresses surprise',
            terrified: 'the text expresses fear or terror',
            curious: 'the text poses a mystery, cliffhanger, or dramatic pause that invites curiosity',
            suspicious: 'the text expresses distrust or wariness',
            neutral: 'the text is emotionally flat',
          },
          choices: ['happy', 'sad', 'angry', 'surprised', 'terrified', 'curious', 'suspicious', 'neutral'],
          instructions:
            'Select the foundational emotion. Flag structural cliffhangers/dramatic pauses as curious or suspicious.',
        },
        tone: {
          type: 'choice',
          criteria: {
            genuine: 'the text is sincere and heartfelt',
            sarcastic: 'the text is ironic or mocking',
            dramatic: 'the text is theatrical or exaggerated',
            casual: 'the text is relaxed and conversational',
          },
          choices: ['genuine', 'sarcastic', 'dramatic', 'casual'],
          instructions: 'Evaluate the delivery style of the input text.',
        },
        intensity: {
          type: 'score',
          criteria: ['barely noticeable', 'subtle', 'moderate', 'intense', 'overwhelming'],
          choices: ['barely noticeable', 'subtle', 'moderate', 'intense', 'overwhelming'],
          instructions: 'Rate the emotional stakes or weight of this scenario.',
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`)
  }

  const data: DecisionResponse = await response.json()
  const results = data.answers
  if (!results) {
    throw new Error('INVALID_RESPONSE')
  }

  const emotion = argMax(results.emotion?.probabilities) as EmotionCategory | undefined
  const tone = argMax(results.tone?.probabilities) as ToneSubtext | undefined
  if (!emotion || !tone) {
    throw new Error('INVALID_RESPONSE')
  }

  // Jev's Score primitive returns a continuous weighted score (e.g., 2.74)
  // We clamp/round it to an index from 0-4 to map to our 5-element array
  const exactScore = results.intensity?.score ?? 1
  const intensity = Math.min(Math.max(Math.round(exactScore), 1), 5)

  return { emotion, tone, intensity }
}