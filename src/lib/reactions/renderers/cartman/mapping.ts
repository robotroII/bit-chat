import type { EmotionCategory, ToneSubtext } from '../../../emotion'
import type { ReactionViewProps } from '../../types'

/** Mouth variants of the vendored Cartman SVG (exclusive choice per face). */
export type CartmanMouth =
  | 'round'
  | 'open'
  | 'rest'
  | 'nasty'
  | 'smileLeft'
  | 'smileRight'
  | 'smile'
export type CartmanEye = 'open' | 'close'
export type CartmanBrow = 'rest' | 'up' | 'down'

/** A fully resolved Cartman face. */
export interface CartmanExpression {
  mouth: CartmanMouth
  eyeLeft: CartmanEye
  eyeRight: CartmanEye
  browLeft: CartmanBrow
  browRight: CartmanBrow
  /** Head tilt in degrees (positive = tilt clockwise). */
  headTiltDeg: number
  /** Shake the whole avatar (rage/panic). */
  shake: boolean
}

/** Idle face: flat mouth, open eyes, resting brows. */
export const NEUTRAL_EXPRESSION: CartmanExpression = {
  mouth: 'rest',
  eyeLeft: 'open',
  eyeRight: 'open',
  browLeft: 'rest',
  browRight: 'rest',
  headTiltDeg: 0,
  shake: false,
}

// Base face per emotion category, before tone/intensity adjustments.
const BASE: Record<
  EmotionCategory,
  Pick<CartmanExpression, 'mouth' | 'eyeLeft' | 'eyeRight' | 'browLeft' | 'browRight'>
> = {
  happy: { mouth: 'smile', eyeLeft: 'open', eyeRight: 'open', browLeft: 'rest', browRight: 'rest' },
  sad: { mouth: 'rest', eyeLeft: 'open', eyeRight: 'open', browLeft: 'down', browRight: 'down' },
  angry: { mouth: 'nasty', eyeLeft: 'open', eyeRight: 'open', browLeft: 'down', browRight: 'down' },
  surprised: { mouth: 'open', eyeLeft: 'open', eyeRight: 'open', browLeft: 'up', browRight: 'up' },
  terrified: { mouth: 'round', eyeLeft: 'open', eyeRight: 'open', browLeft: 'up', browRight: 'up' },
  curious: { mouth: 'round', eyeLeft: 'open', eyeRight: 'open', browLeft: 'up', browRight: 'rest' },
  suspicious: { mouth: 'rest', eyeLeft: 'open', eyeRight: 'open', browLeft: 'up', browRight: 'down' },
  neutral: { mouth: 'rest', eyeLeft: 'open', eyeRight: 'open', browLeft: 'rest', browRight: 'rest' },
}

// Delivery style tweaks layered on top of the base face.
function applyTone(expr: CartmanExpression, tone: ToneSubtext, emotion: EmotionCategory): void {
  switch (tone) {
    case 'sarcastic':
      // Asymmetric smirk with one raised brow — the classic "yeah, right".
      expr.mouth = 'smileLeft'
      expr.browLeft = 'up'
      expr.browRight = emotion === 'angry' ? 'down' : 'rest'
      break
    case 'dramatic':
      // Theatrical escalation: anything held back opens up, brows shoot up.
      if (expr.mouth === 'rest') expr.mouth = 'open'
      expr.browLeft = 'up'
      expr.browRight = 'up'
      break
    case 'casual':
      // Relaxed delivery: soften theatrical faces back to rest (a frown stays).
      if (expr.mouth !== 'smile') expr.mouth = 'rest'
      if (expr.browLeft === 'up') expr.browLeft = 'rest'
      if (expr.browRight === 'up') expr.browRight = 'rest'
      break
    case 'genuine':
      break
  }
}

/** Resolve the Cartman face for the current UI state. */
export function resolveCartmanExpression(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting'>,
): CartmanExpression {
  const { result, reacting } = props
  if (!reacting || !result) return NEUTRAL_EXPRESSION

  const expr: CartmanExpression = { ...BASE[result.emotion], headTiltDeg: 0, shake: false }
  applyTone(expr, result.tone, result.emotion)

  // Head language: curiosity peeks sideways, suspicion leans back.
  if (result.emotion === 'curious') expr.headTiltDeg = 4
  else if (result.emotion === 'suspicious') expr.headTiltDeg = -4

  // High stakes (rage, panic, melodrama) shake the avatar.
  expr.shake =
    result.intensity >= 4 &&
    (result.emotion === 'angry' || result.emotion === 'terrified' || result.tone === 'dramatic')

  return expr
}
