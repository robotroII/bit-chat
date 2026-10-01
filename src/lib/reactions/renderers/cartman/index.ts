import type { ReactionRenderer } from '../../types'
import CartmanFace from './CartmanFace.svelte'

/** Cartman SVG avatar (vendored from jeeliz/jeelizWeboji demos/svg), text-driven. */
export const cartmanRenderer: ReactionRenderer = {
  id: 'cartman',
  label: 'Cartman',
  component: CartmanFace,
}
