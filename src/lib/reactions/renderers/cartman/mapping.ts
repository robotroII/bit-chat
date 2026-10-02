import type { AvatarExpression } from '../../avatar-expression'
import { resolveAvatarExpression } from '../../avatar-expression'
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

/**
 * Adapter: unified AvatarExpression weights → discrete Cartman SVG variants.
 * The emotion→face mapping lives in resolveAvatarExpression; this only
 * quantizes weights into the artwork's exclusive choices.
 */
export function cartmanFromAvatarExpression(
  ax: AvatarExpression,
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting' | 'speaking' | 'voiceMouthOpen'>,
): CartmanExpression {
  const expr: CartmanExpression = { ...NEUTRAL_EXPRESSION }

  // Mouth: strongest signal wins; smirk (asymmetric smile) beats plain smile.
  // Thresholds sit just above noise: the artwork is binary, and the strength
  // scaling already communicates intensity through the scale swell.
  // While Jev is speaking, articulation wins: the talking mouth flaps with
  // the voice envelope instead of freezing in an expression variant.
  if (props.speaking && ax.mouthOpen > 0.08) {
    expr.mouth = 'open'
  } else if (ax.smileLeft > 0.3 || ax.smileRight > 0.3) {
    expr.mouth = ax.smileLeft >= ax.smileRight ? 'smileLeft' : 'smileRight'
  } else if (ax.smile > 0.08) {
    expr.mouth = 'smile'
  } else if (ax.mouthPucker > 0.08) {
    expr.mouth = 'round'
  } else if (ax.mouthOpen > 0.08) {
    expr.mouth = 'open'
  } else if (ax.angry > 0.25) {
    expr.mouth = 'nasty'
  }

  // Brows: inner-up (raise) vs down (frown), quantized at 0.35.
  const browUp = ax.browInnerUp > 0.35
  const browDown = ax.browDown > 0.35
  expr.browLeft = browUp ? 'up' : browDown ? 'down' : 'rest'
  expr.browRight = browUp ? 'up' : browDown ? 'down' : 'rest'
  // Asymmetric overrides (the weights are bilateral; these read the combos):
  // smirk → one raised brow, suspicion → up/down, curiosity → up/rest.
  if (ax.smileLeft > 0.4 && ax.browInnerUp > 0.3) {
    expr.browLeft = 'up'
    expr.browRight = 'rest'
  }
  if (ax.headTilt < -0.3 && ax.browInnerUp > 0.2 && ax.browDown > 0.2) {
    expr.browLeft = 'up'
    expr.browRight = 'down'
  } else if (ax.headTilt > 0.3 && ax.browInnerUp > 0.2 && ax.browDown <= 0.2) {
    expr.browLeft = 'up'
    expr.browRight = 'rest'
  }

  // Eyes: wide/squint stay open (the artwork has no squint variant); blink
  // closes both.
  if (ax.blink > 0.5) {
    expr.eyeLeft = 'close'
    expr.eyeRight = 'close'
  }

  // Head language: tilt weight → degrees (±5° range).
  expr.headTiltDeg = ax.headTilt * 5

  // High stakes (rage, panic, melodrama) shake the avatar.
  const { result, reacting } = props
  expr.shake =
    !!reacting &&
    !!result &&
    result.intensity >= 4 &&
    (result.emotion === 'angry' || result.emotion === 'terrified' || result.tone === 'dramatic')

  return expr
}

/** Resolve the Cartman face for the current UI state. */
export function resolveCartmanExpression(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting' | 'speaking' | 'voiceMouthOpen'>,
): CartmanExpression {
  return cartmanFromAvatarExpression(resolveAvatarExpression(props), props)
}
