import type { EmotionCategory, ToneSubtext } from '../../../emotion'
import type { ReactionViewProps } from '../../types'

export const NEUTRAL_EMOJI = '😐'
export const LISTENING_EMOJI = '🙂'

// Map multidimensional outcomes to specific UTF emojis.
// Structure: [Category][Tone][Intensity 1-5]
export const emojiMatrix: Record<EmotionCategory, Record<ToneSubtext, string[]>> = {
  curious: {
    genuine: ['🤔', '🧐', '😯', '😮', '😲'],
    sarcastic: ['🤨', '🙄', '😏', '😒', '🤥'],
    dramatic: ['😯', '😮', '😳', '😲', '😱'],
    casual: ['😌', '🤔', '😉', '🫢', '😮'],
  },
  suspicious: {
    genuine: ['😑', '🤨', '😒', '🧐', '😠'],
    sarcastic: ['😏', '🙃', '😜', '🤭', '🤥'],
    dramatic: ['😟', '😧', '😰', '😨', '😱'],
    casual: ['🤔', '🤨', '🫢', '🤫', '😬'],
  },
  happy: {
    genuine: ['🙂', '😃', '😀', '😁', '😆'],
    sarcastic: ['🙃', '😏', '😜', '🤪', '🤣'],
    dramatic: ['😄', '🤩', '🥳', '😍', '🥰'],
    casual: ['😌', '😉', '😎', '😋', '🤗'],
  },
  sad: {
    genuine: ['🙁', '😞', '😢', '😭', '😩'],
    sarcastic: ['🙃', '🥲', '😅', '🫠', '😭'],
    dramatic: ['😔', '🥺', '😪', '😭', '😫'],
    casual: ['😕', '😥', '😓', '😪', '😴'],
  },
  angry: {
    genuine: ['😒', '😠', '😤', '😡', '🤬'],
    sarcastic: ['🙃', '🙄', '😒', '😏', '😤'],
    dramatic: ['😠', '😤', '😡', '🤬', '🤯'],
    casual: ['😑', '😒', '😤', '😠', '😡'],
  },
  surprised: {
    genuine: ['😮', '😲', '😳', '😱', '🤯'],
    sarcastic: ['🥱', '🙄', '😏', '😒', '🙃'],
    dramatic: ['😯', '😲', '😱', '😵', '🤯'],
    casual: ['😯', '😮', '😲', '🫢', '😳'],
  },
  terrified: {
    genuine: ['😟', '😨', '😰', '😱', '😵'],
    sarcastic: ['😅', '😬', '🥴', '🫠', '😵‍💫'],
    dramatic: ['😨', '😰', '😱', '🥶', '😵'],
    casual: ['😬', '😓', '🥶', '😰', '😳'],
  },
  neutral: {
    genuine: ['😐', '😑', '😶', '🫥', '🤐'],
    sarcastic: ['🙄', '😑', '😒', '😏', '🙃'],
    dramatic: ['😶', '🫥', '🥱', '😴', '🤐'],
    casual: ['😌', '😴', '🥱', '😪', '😶'],
  },
}

/** Resolve the display emoji for the current UI state. */
export function resolveEmoji(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting'>,
): string {
  const { result, listening, reacting } = props
  if (reacting && result) {
    return emojiMatrix[result.emotion][result.tone][result.intensity - 1] || NEUTRAL_EMOJI
  }
  return listening ? LISTENING_EMOJI : NEUTRAL_EMOJI
}
