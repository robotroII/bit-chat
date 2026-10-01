import type { ReactionRenderer } from '../../types'
import VrmFace from './VrmFace.svelte'

/** Seed-san VRM 1.0 renderer (@pixiv/three-vrm + three.js). */
export const vrmRenderer: ReactionRenderer = {
  id: 'vrm',
  label: 'Seed-san (VRM)',
  component: VrmFace,
}
