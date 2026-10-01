import type { EmotionCategory } from '../emotion'
import type { ReactionViewProps } from './types'

/**
 * Unified facial-expression model — the single intermediate layer between
 * the emotion analysis and every avatar renderer:
 *
 *   ReactionResult ─┬─→ emoji renderer (legacy, consumes the result directly)
 *                   └─→ resolveAvatarExpression() ─→ AvatarExpression
 *                                                        │
 *                                    ┌───────────────────┼─────────────────┐
 *                                    ▼                   ▼                 ▼
 *                                  Kugutu              JEELIZ SVG        VRM 1.0
 *
 * Every channel is a normalized weight: 0..1 for face channels, -1..1 for
 * gaze/headTilt. Renderers interpret the weights their own way (quantize to
 * discrete SVG variants, feed blendshapes, drive bones), so adding an avatar
 * never touches the mapping above.
 *
 * Channel names deliberately mirror VRM 1.0 / ARKit-style blendshape names so
 * a `@pixiv/three-vrm` renderer can forward them almost 1:1:
 *   happy/sad/angry/surprised/relaxed → VRM standard presets
 *   blink → `blink`, gazeX/gazeY → lookLeft/lookRight/lookUp/lookDown mix
 *   smileLeft/smileRight → VRM `mouthSmileLeft`/`mouthSmileRight`
 *   mouthPucker → VRM `mouthPucker`/`mouthFunnel`
 */
export interface AvatarExpression {
  // emotional
  happy: number
  sad: number
  angry: number
  surprised: number
  relaxed: number

  // eyes
  blink: number
  eyeSquint: number
  eyeWide: number

  // brows
  browInnerUp: number
  browDown: number

  // mouth
  smile: number
  mouthOpen: number
  mouthPucker: number

  // gaze (-1..1)
  gazeX: number
  gazeY: number

  // asymmetry
  smileLeft: number
  smileRight: number

  // head (-1..1)
  headTilt: number
}

/** All-zero face: the idle pose every renderer treats as "do nothing". */
export const NEUTRAL_AVATAR_EXPRESSION: AvatarExpression = {
  happy: 0,
  sad: 0,
  angry: 0,
  surprised: 0,
  relaxed: 0,
  blink: 0,
  eyeSquint: 0,
  eyeWide: 0,
  browInnerUp: 0,
  browDown: 0,
  smile: 0,
  mouthOpen: 0,
  mouthPucker: 0,
  gazeX: 0,
  gazeY: 0,
  smileLeft: 0,
  smileRight: 0,
  headTilt: 0,
}

/** Highest emotional weight — a cheap "how strong is this feeling" scalar. */
export function emotionalPeak(ax: AvatarExpression): number {
  return Math.max(ax.happy, ax.sad, ax.angry, ax.surprised, ax.relaxed)
}

// Base facial expression per emotion category, at intensity = 1.
// This is the "Emotion → FacialExpression" stage of the pipeline.
const EMOTION_BASE: Record<EmotionCategory, Partial<AvatarExpression>> = {
  happy: { happy: 1, smile: 1, browInnerUp: 0.2 },
  sad: { sad: 1, browInnerUp: 0.7, eyeSquint: 0.15 },
  angry: { angry: 1, browDown: 1, eyeSquint: 0.4 },
  surprised: { surprised: 1, eyeWide: 1, browInnerUp: 0.9, mouthOpen: 0.5 },
  // Fear: wide eyes + puckered o-mouth, a blend of shock and dread.
  terrified: { surprised: 0.7, sad: 0.3, eyeWide: 1, browInnerUp: 0.8, mouthPucker: 1, mouthOpen: 0.3 },
  // One-sided raise + slight tilt: the "hmm?" face.
  curious: { surprised: 0.4, relaxed: 0.2, browInnerUp: 0.8, mouthPucker: 0.6, headTilt: 0.5 },
  // Squint + half frown + lean-away: distrust. browInnerUp on one side
  // (renderers pair it with browDown for the asymmetric raise).
  suspicious: { angry: 0.35, relaxed: 0.1, browInnerUp: 0.5, browDown: 0.55, eyeSquint: 0.5, headTilt: -0.4 },
  neutral: { relaxed: 0.3 },
}

/**
 * Emotion → FacialExpression → AvatarExpression.
 * The one function every avatar renderer shares.
 */
export function resolveAvatarExpression(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting'>,
): AvatarExpression {
  const { result, listening, reacting } = props
  if (!reacting || !result) {
    // Idle/listening: a thinking glance up-left while the user types.
    return listening
      ? { ...NEUTRAL_AVATAR_EXPRESSION, relaxed: 0.3, gazeX: -0.35, gazeY: -0.3 }
      : NEUTRAL_AVATAR_EXPRESSION
  }

  const { emotion, tone, intensity: level } = result
  const ax: AvatarExpression = { ...NEUTRAL_AVATAR_EXPRESSION, ...EMOTION_BASE[emotion] }

  // Global strength: analysis level 1-5 → 0.2-1, casual dampens, dramatic floors high.
  let strength = level / 5
  if (tone === 'casual') strength *= 0.65
  if (tone === 'dramatic') strength = Math.max(strength, 0.9)
  for (const key of ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'eyeSquint', 'eyeWide', 'browInnerUp', 'browDown', 'smile', 'mouthOpen', 'mouthPucker'] as const) {
    ax[key] *= strength
  }

  // Delivery style, layered on top of the scaled base.
  switch (tone) {
    case 'sarcastic':
      // Asymmetric smirk with one raised brow — the classic "yeah, right".
      ax.smileLeft = Math.max(ax.smile, 0.9)
      ax.smile = 0
      ax.browInnerUp = Math.max(ax.browInnerUp, 0.5)
      ax.headTilt = 0.2
      break
    case 'dramatic':
      // Theatrical escalation: jaw drops, eyes widen.
      ax.mouthOpen = Math.max(ax.mouthOpen, 0.35)
      ax.eyeWide = Math.max(ax.eyeWide, 0.4)
      break
    case 'casual':
    case 'genuine':
      break
  }

  return ax
}
