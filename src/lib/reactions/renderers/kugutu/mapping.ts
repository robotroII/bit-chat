import type { CharPack } from '@kugutu/schema'
import type { EmotionCategory, ToneSubtext } from '../../../emotion'
import type { ReactionViewProps } from '../../types'
import bundleJson from './jev.bundle.json'
import svgText from './jev.svg?raw'

export type KugutuGesture = 'nod' | 'shake' | 'bounce'

/** One imperative frame of Jev actor state, resolved from the reaction UI. */
export interface KugutuDirection {
  /** Expression id (authored in jev.bundle.json). */
  emotion: string
  /** Expression intensity 0..1 (analysis intensity 1-5 scaled). */
  intensity: number
  /** Mouth part id to select via setPart. */
  mouth: string
  /** Mouth open crossfade amount 0..1. */
  mouthOpen: number
  /** One-shot gesture to play (sarcastic head shake, dramatic bounce). */
  gesture: KugutuGesture | null
  /** Gaze target -1..1 (listening = thinking look up-left). */
  lookAt: { x: number; y: number }
}

/** Mouth artwork per emotion × tone (part ids baked into jev.svg). */
const MOUTH_BY_TONE: Record<EmotionCategory, Record<ToneSubtext, string>> = {
  happy: {
    genuine: 'mouth-smile',
    sarcastic: 'mouth-smirk',
    dramatic: 'mouth-grin',
    casual: 'mouth-smile',
  },
  sad: {
    genuine: 'mouth-frown',
    sarcastic: 'mouth-frown',
    dramatic: 'mouth-frown',
    casual: 'mouth-frown',
  },
  angry: {
    genuine: 'mouth-nasty',
    sarcastic: 'mouth-smirk',
    dramatic: 'mouth-nasty',
    casual: 'mouth-frown',
  },
  surprised: {
    genuine: 'mouth-open',
    sarcastic: 'mouth-open',
    dramatic: 'mouth-open',
    casual: 'mouth-open',
  },
  terrified: {
    genuine: 'mouth-o',
    sarcastic: 'mouth-o',
    dramatic: 'mouth-o',
    casual: 'mouth-o',
  },
  curious: {
    genuine: 'mouth-o',
    sarcastic: 'mouth-smirk',
    dramatic: 'mouth-o',
    casual: 'mouth-o',
  },
  suspicious: {
    genuine: 'mouth-neutral',
    sarcastic: 'mouth-smirk',
    dramatic: 'mouth-neutral',
    casual: 'mouth-neutral',
  },
  neutral: {
    genuine: 'mouth-neutral',
    sarcastic: 'mouth-neutral',
    dramatic: 'mouth-neutral',
    casual: 'mouth-neutral',
  },
}

/** Resolve the Jev actor state for the current UI state. */
export function resolveKugutuDirection(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting'>,
): KugutuDirection {
  const { result, listening, reacting } = props
  if (!reacting || !result) {
    return {
      emotion: 'neutral',
      intensity: 0,
      mouth: 'mouth-neutral',
      mouthOpen: 0.08,
      gesture: null,
      // While the user types, Jev glances up-left like he is thinking.
      lookAt: listening ? { x: -0.35, y: -0.3 } : { x: 0, y: 0 },
    }
  }

  const { emotion, tone, intensity: level } = result
  let intensity = level / 5
  if (tone === 'casual') intensity *= 0.65
  if (tone === 'dramatic') intensity = Math.max(intensity, 0.9)

  let mouthOpen = 0.08
  if (emotion === 'surprised') mouthOpen = 0.45
  else if (emotion === 'terrified') mouthOpen = 0.3
  else if (emotion === 'curious') mouthOpen = 0.2
  if (tone === 'dramatic') mouthOpen = Math.max(mouthOpen, 0.35)

  const gesture: KugutuGesture | null =
    tone === 'sarcastic'
      ? 'shake' // the "yeah, right" head shake
      : tone === 'dramatic' && level >= 4
        ? 'bounce'
        : null

  return {
    emotion,
    intensity,
    mouth: MOUTH_BY_TONE[emotion][tone],
    mouthOpen,
    gesture,
    lookAt: { x: 0, y: 0 },
  }
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
