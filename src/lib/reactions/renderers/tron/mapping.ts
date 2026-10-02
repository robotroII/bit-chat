import * as THREE from 'three'
import type { EmotionCategory } from '../../../emotion'
import type { AvatarExpression } from '../../avatar-expression'
import { emotionalPeak, resolveAvatarExpression } from '../../avatar-expression'
import type { ReactionViewProps } from '../../types'

/**
 * Everything the Tron Bit needs to render the current state. A Bit has no
 * face — emotion is expressed through color, glow, motion and posture, the
 * way the 1982 movie's programs read each other.
 */
export interface TronBitState {
  /** Edge/body color of the bit (emotion-coded). */
  color: THREE.Color
  /** Emissive brightness multiplier for the edge wireframe (0..~2). */
  glow: number
  /** Idle spin speed in rad/s. */
  spin: number
  /** Posture tilt in radians (from headTilt, ±10° like the VRM renderer). */
  tilt: number
  /** Hover drift from gaze channels (-1..1 → world units). */
  driftX: number
  driftY: number
  /** Scale pulse amplitude 0..1 (mouthOpen incl. TTS lip-sync). */
  pulse: number
  /** Blink → a quick vertical squash "flicker" (0..1). */
  squash: number
  /** Movie yes/no shape morph (octa default, tetra YES, disc NO). */
  shape: BitShape
  /** High-frequency position shake amplitude (anger, panic). */
  jitter: number
  /** Vertical oscillation amplitude (excitement, the YES hop). */
  bob: number
  /** Vertical oscillation frequency in Hz. */
  bobHz: number
  /** Downward drift (sadness weighs the bit down). */
  sink: number
  /** Extra z-axis lean (suspicion leans away). */
  lean: number
  /** Glow flicker depth (terrified = unstable program). */
  flicker: number
  /** Horizontal patrol amplitude while responding (left ↔ right wander). */
  wander: number
  /** Patrol frequency in Hz (a full left→right→left cycle per period). */
  wanderHz: number
}

/**
 * Emotion → bit color. Covers every EmotionCategory the classifier emits;
 * the dominant weight picks the hue.
 */
const EMOTION_COLOR: Record<string, number> = {
  happy: 0x00e5ff, // cyan — the classic program blue
  relaxed: 0x00b3a4, // teal — calm
  surprised: 0xffffff, // white — flash
  sad: 0x2244ff, // deep blue — dimmed sorrow
  angry: 0xff2244, // red — hostile program
  terrified: 0xff5522, // red-orange — panic
  curious: 0xffaa00, // amber — investigating
  suspicious: 0xff00aa, // magenta — distrust
  neutral: 0x0891b2, // dim cyan idle
}

/**
 * The three Bit shapes from the 1982 movie: the default octahedron, the
 * tetrahedron it morphs into to say YES, and the flattened disc for NO.
 */
export type BitShape = 'octa' | 'tetra' | 'disc'

/**
 * Per-emotion motion signature — the second expressive layer beyond color.
 * All values are target-state modifiers consumed by the render loop:
 * - `shape`: the movie's yes/no morphs (happy = emphatic YES, sad = NO)
 * - `jitter`: high-frequency position shake (anger, panic)
 * - `bob`: vertical oscillation amplitude (excitement, the YES hop)
 * - `bobHz`: bob frequency
 * - `sink`: downward drift (sadness weighs the bit down)
 * - `lean`: extra z-axis lean (suspicion leans away from the user)
 * - `flicker`: glow flicker depth (terrified = unstable program)
 */
export interface BitMotion {
  shape: BitShape
  jitter: number
  bob: number
  bobHz: number
  sink: number
  lean: number
  flicker: number
  /** Horizontal patrol amplitude while responding (left ↔ right wander). */
  wander: number
  /** Patrol frequency in Hz (a full left→right→left cycle per period). */
  wanderHz: number
}

const MOTION_NEUTRAL: BitMotion = {
  shape: 'octa',
  jitter: 0,
  bob: 0,
  bobHz: 0,
  sink: 0,
  lean: 0,
  flicker: 0,
  wander: 0,
  wanderHz: 0,
}

/**
 * Emotion → motion signature. Tuned LOUD so each state reads instantly
 * even from across the room: happy hops emphatically, sad sinks deep,
 * angry shakes violently, terrified flickers hard, suspicious leans away,
 * curious bobs while investigating. Every responding state also patrols
 * the landscape canvas (wander) — pacing speed matches the feeling.
 */
const MOTION_BY_EMOTION: Record<EmotionCategory, BitMotion> = {
  happy: { shape: 'tetra', jitter: 0, bob: 0.45, bobHz: 4, sink: 0, lean: 0, flicker: 0, wander: 1.0, wanderHz: 0.25 },
  sad: { shape: 'disc', jitter: 0, bob: 0, bobHz: 0, sink: 0.55, lean: 0, flicker: 0, wander: 0.5, wanderHz: 0.1 },
  angry: { shape: 'octa', jitter: 0.2, bob: 0, bobHz: 0, sink: 0, lean: 0, flicker: 0, wander: 1.1, wanderHz: 0.3 },
  surprised: { shape: 'octa', jitter: 0, bob: 0.25, bobHz: 6, sink: 0, lean: 0, flicker: 0, wander: 0.8, wanderHz: 0.4 },
  terrified: { shape: 'octa', jitter: 0.28, bob: 0.15, bobHz: 8, sink: 0.2, lean: 0, flicker: 0.8, wander: 1.2, wanderHz: 0.5 },
  curious: { shape: 'octa', jitter: 0, bob: 0.2, bobHz: 2, sink: 0, lean: 0.25, flicker: 0, wander: 0.9, wanderHz: 0.18 },
  suspicious: { shape: 'octa', jitter: 0, bob: 0, bobHz: 0, sink: 0.15, lean: -0.6, flicker: 0, wander: 0.7, wanderHz: 0.12 },
  neutral: MOTION_NEUTRAL,
}

/** Emotion category → bit shape (the movie's yes/no morphs). */
export function shapeForEmotion(emotion: EmotionCategory): BitShape {
  return MOTION_BY_EMOTION[emotion].shape
}

/** Emotion category → motion signature. */
export function motionForEmotion(emotion: EmotionCategory): BitMotion {
  return MOTION_BY_EMOTION[emotion]
}

/**
 * Listening signature: the bit leans in toward the user and nods gently —
 * the "I'm all ears" pose. Distinct from every emotion signature so the
 * listening state reads clearly on an abstract shape (brow/gaze channels
 * alone are invisible here).
 */
export const MOTION_LISTENING: BitMotion = {
  shape: 'octa',
  jitter: 0,
  bob: 0.12,
  bobHz: 1.2,
  sink: 0,
  lean: 0.25,
  flicker: 0,
  wander: 0,
  wanderHz: 0,
}

/** Listening color: amber — "I'm all ears" (the curious hue, reused). */
const LISTENING_COLOR = new THREE.Color(0xffaa00)

/** Fallback for unknown categories. */
const NEUTRAL_COLOR = new THREE.Color(EMOTION_COLOR.neutral!)

/** Emotion category → bit color (covers every EmotionCategory). */
export function colorForEmotion(emotion: EmotionCategory): THREE.Color {
  return new THREE.Color(EMOTION_COLOR[emotion] ?? EMOTION_COLOR.neutral!)
}

/** Dominant emotion channel → bit color (argmax over the 5 channels). */
function colorFromChannels(ax: AvatarExpression): THREE.Color {
  // 'relaxed' is an expression channel, not an analysis category, but it
  // still colors the bit (teal) — e.g. the listening pose.
  const entries: [string, number][] = [
    ['happy', ax.happy],
    ['sad', ax.sad],
    ['angry', ax.angry],
    ['surprised', ax.surprised],
    ['relaxed', ax.relaxed],
  ]
  let best = 'neutral'
  let bestWeight = 0.02 // below this, stay neutral
  for (const [name, weight] of entries) {
    if (weight > bestWeight) {
      best = name
      bestWeight = weight
    }
  }
  return new THREE.Color(EMOTION_COLOR[best] ?? EMOTION_COLOR.neutral!)
}

/**
 * AvatarExpression → TronBitState. The channel translation stage for the
 * Tron renderer, mirroring `vrmFromAvatarExpression` in the VRM renderer.
 *
 * `emotion` overrides the dominant-channel argmax for the color when the
 * analysis category is known — blended bases (terrified = surprised+sad,
 * curious, suspicious) would otherwise argmax to the generic channel color
 * and their dedicated hues would be unreachable.
 */
export function tronFromAvatarExpression(ax: AvatarExpression, emotion?: EmotionCategory): TronBitState {
  const peak = emotionalPeak(ax)
  const color = emotion ? colorForEmotion(emotion) : colorFromChannels(ax)
  // Motion signature comes from the analysis category when known; the
  // channel-argmax fallback (idle/listening) stays on the neutral signature.
  const motion = emotion ? motionForEmotion(emotion) : MOTION_NEUTRAL

  return {
    color,
    // Idle glow 0.4, up to ~2.0 at full emotional peak.
    glow: 0.4 + peak * 1.6,
    // Slow idle spin; strong feelings spin faster. Anger gets jittery.
    spin: (0.6 + peak * 2.5) * (ax.angry > 0.3 ? 1.8 : 1),
    // Same posture range as the VRM head tilt, but wider (±15°) so the
    // tilt reads on an abstract shape with no facial cues.
    tilt: ax.headTilt * (15 * (Math.PI / 180)),
    // Gaze drifts the bit around its hover point.
    driftX: ax.gazeX * 0.25,
    driftY: ax.gazeY * 0.25,
    // Mouth open (incl. TTS lip-sync) → scale pulse.
    pulse: ax.mouthOpen,
    // Blink → vertical squash flicker.
    squash: ax.blink,
    ...motion,
  }
}

/** Resolve the Tron bit state for the current UI state. */
export function resolveTronState(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting' | 'speaking' | 'voiceMouthOpen'>,
): TronBitState {
  const ax = resolveAvatarExpression(props)
  // Only a held reaction colors the bit by category; idle/listening poses
  // fall back to the channel argmax (relaxed → teal, neutral → dim cyan).
  const emotion = props.reacting && props.result ? props.result.emotion : undefined
  const state = tronFromAvatarExpression(ax, emotion)
  // Listening (mic open or the user typing): lean in + amber so the state
  // is unmistakable. A held emotion keeps precedence — mid-speech live
  // previews must not be masked by the listening pose.
  if (!emotion && props.listening) {
    state.color = LISTENING_COLOR.clone()
    Object.assign(state, MOTION_LISTENING)
  }
  return state
}