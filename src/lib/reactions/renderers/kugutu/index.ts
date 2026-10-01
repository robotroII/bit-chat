import type { ReactionRenderer } from '../../types'
import KugutuFace from './KugutuFace.svelte'

/** Jev — Cartman-like Kugutu character (https://github.com/neka-nat/kugutu). */
export const kugutuRenderer: ReactionRenderer = {
  id: 'kugutu',
  label: 'Kugutu',
  component: KugutuFace,
}
