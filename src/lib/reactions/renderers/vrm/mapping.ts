import type { VRMExpressionPresetName } from '@pixiv/three-vrm'
import type { AvatarExpression } from '../../avatar-expression'
import { resolveAvatarExpression } from '../../avatar-expression'
import type { ReactionViewProps } from '../../types'

/**
 * Adapter: unified AvatarExpression weights → VRM 1.0 expression presets.
 * The channel names were chosen to mirror VRM presets, so this is nearly 1:1.
 * Seed-san ships the full standard preset set (happy, angry, sad, relaxed,
 * surprised, blink, aa, ou, lookUp/Down/Left/Right, neutral).
 */
export function vrmFromAvatarExpression(ax: AvatarExpression): Partial<
  Record<VRMExpressionPresetName, number>
> {
  return {
    // Emotional presets (Seed-san has all five).
    happy: ax.happy,
    sad: ax.sad,
    angry: ax.angry,
    surprised: ax.surprised,
    relaxed: ax.relaxed,

    // Eyes: blink is driven by the model's own override rules; squint/wide
    // have no standard preset and are dropped (Seed-san has no custom ones).
    blink: ax.blink,

    // Mouth: smile → aa (open mouth), pucker → ou (rounded o-mouth).
    aa: ax.mouthOpen,
    ou: ax.mouthPucker,

    // Gaze: Seed-san's LookAt is expression-driven, so gaze weights map
    // directly onto the look* presets.
    lookLeft: ax.gazeX < 0 ? -ax.gazeX : 0,
    lookRight: ax.gazeX > 0 ? ax.gazeX : 0,
    lookUp: ax.gazeY > 0 ? ax.gazeY : 0,
    lookDown: ax.gazeY < 0 ? -ax.gazeY : 0,
  }
}

/** Head tilt weight → degrees for the neck/head bone (±10° range). */
export function headTiltToDegrees(ax: AvatarExpression): number {
  return ax.headTilt * 10
}

/** Resolve the VRM expression map for the current UI state. */
export function resolveVrmExpressions(
  props: Pick<ReactionViewProps, 'result' | 'listening' | 'reacting' | 'speaking' | 'voiceMouthOpen'>,
): Partial<Record<VRMExpressionPresetName, number>> {
  return vrmFromAvatarExpression(resolveAvatarExpression(props))
}
