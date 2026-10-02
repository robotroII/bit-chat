import type { CharPack } from '@kugutu/schema'
import type { AvatarExpression } from '../../avatar-expression'
import { emotionalPeak, resolveAvatarExpression } from '../../avatar-expression'
import type { ReactionViewProps } from '../../types'
import bundleJson from './jev.bundle.json'
import svgText from './jev.svg?raw'

export type KugutuGesture = 'nod' | 'shake' | 'bounce'

/** One imperative frame of Jev actor state, resolved from the reaction UI. */
export interface KugutuDirection {
  /** Expression id (authored in jev.bundle.json). */
  emotion: string
  /** Expression intensity 0..1. */
  intensity: number
  /** Mouth part id to select via setPart. */
  mouth: string
  /** Mouth open crossfade amount 0..1. */
  mouthOpen: number
  /** One-shot gesture to play (sarcastic head shake, dramatic bounce). */
  gesture: KugutuGesture | null
  /** Gaze target -1..1. */
  lookAt: { x: number; y: number }
}

/**
 * Adapter: unified AvatarExpression weights → Kugutu actor calls.
 * Kugutu's expression API is discrete (setEmotion(id, intensity)), so the
 * dominant emotional weight becomes the expression id and the overall peak
 * becomes the intensity. Mouth artwork follows the mouth weights.
 */
export function kugutuFromAvatarExpression(
  ax: AvatarExpression,
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting' | 'speaking' | 'voiceMouthOpen'>,
): KugutuDirection {
  const { listening, reacting } = props

  // Dominant emotion → authored expression id (kugutu scales its poses by
  // intensity, so the runner-up weights are approximated by the peak).
  // terrified/curious/suspicious are recognized by their weight signatures;
  // the +0.05 bias breaks the terrified/surprised tie (terrified is a
  // superset of surprised's weights).
  const candidates: [string, number][] = [
    ['happy', ax.happy],
    ['sad', ax.sad],
    ['angry', ax.angry],
    ['surprised', ax.surprised],
    ['terrified', ax.mouthPucker > 0.4 && ax.eyeWide > 0.4 ? Math.max(ax.surprised, ax.sad) + 0.05 : 0],
    ['curious', ax.headTilt > 0.3 && ax.browInnerUp > 0.15 ? ax.browInnerUp : 0],
    ['suspicious', ax.headTilt < -0.3 && ax.eyeSquint > 0.15 ? ax.eyeSquint : 0],
  ]
  const [emotion, emotionWeight] = candidates.reduce((a, b) => (b[1] > a[1] ? b : a))
  // All-zero candidates (e.g. a barely-there neutral reaction) → neutral face.
  const resolvedEmotion = emotionWeight < 0.02 ? 'neutral' : emotion
  const intensity = Math.max(emotionalPeak(ax), emotionWeight)

  // Mouth artwork from the mouth weights (part ids baked into jev.svg).
  let mouth = 'mouth-neutral'
  if (ax.smileLeft > 0.3 || ax.smileRight > 0.3) mouth = 'mouth-smirk'
  else if (ax.smile > 0.7) mouth = 'mouth-grin'
  else if (ax.smile > 0.1) mouth = 'mouth-smile'
  else if (ax.mouthPucker > 0.12) mouth = 'mouth-o'
  else if (ax.mouthOpen > 0.05) mouth = 'mouth-open'
  else if (ax.sad > 0.25) mouth = 'mouth-frown'
  else if (ax.angry > 0.25) mouth = 'mouth-nasty'

  // One-shot gestures: sarcastic head shake, dramatic bounce at high stakes.
  const { result } = props
  const gesture: KugutuGesture | null =
    ax.smileLeft > 0.4
      ? 'shake' // the "yeah, right" head shake
      : result && result.tone === 'dramatic' && result.intensity >= 4
        ? 'bounce'
        : null

  return {
    emotion: resolvedEmotion,
    intensity,
    mouth,
    mouthOpen: Math.max(ax.mouthOpen, 0.08),
    gesture: reacting ? gesture : null,
    lookAt: { x: ax.gazeX, y: ax.gazeY },
  }
}

/** Resolve the Jev actor state for the current UI state. */
export function resolveKugutuDirection(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting' | 'speaking' | 'voiceMouthOpen'>,
): KugutuDirection {
  return kugutuFromAvatarExpression(resolveAvatarExpression(props), props)
}

/**
 * Assemble the CharPack from the authored bundle + rig SVG.
 * The SVG is imported verbatim (vite ?raw) so the artwork stays readable.
 */
export function buildJevPack(): CharPack {
  return {
    packVersion: '0.1.0',
    bundle: bundleJson,
    assets: [{ id: 'primary-svg', type: 'svg', content: svgText }],
  } as unknown as CharPack
}
