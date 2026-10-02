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

  return {
    color,
    // Idle glow 0.4, up to ~2.0 at full emotional peak.
    glow: 0.4 + peak * 1.6,
    // Slow idle spin; strong feelings spin faster. Anger gets jittery.
    spin: (0.6 + peak * 2.5) * (ax.angry > 0.3 ? 1.8 : 1),
    // Same ±10° posture range as the VRM head tilt.
    tilt: ax.headTilt * (10 * (Math.PI / 180)),
    // Gaze drifts the bit around its hover point.
    driftX: ax.gazeX * 0.15,
    driftY: ax.gazeY * 0.15,
    // Mouth open (incl. TTS lip-sync) → scale pulse.
    pulse: ax.mouthOpen,
    // Blink → vertical squash flicker.
    squash: ax.blink,
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
  return tronFromAvatarExpression(ax, emotion)
}