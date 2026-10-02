import type { ReactionRenderer } from '../../types'
import TronFace from './TronFace.svelte'

/** Tron Bit (1982) — glowing octahedron program, plain three.js. */
export const tronRenderer: ReactionRenderer = {
  id: 'tron',
  label: 'Tron Bit',
  component: TronFace,
}