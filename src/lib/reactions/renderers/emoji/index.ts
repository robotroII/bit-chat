import type { ReactionRenderer } from '../../types'
import EmojiFace from './EmojiFace.svelte'

/** Classic UTF emoji renderer — dev-only preview of the original web-jev display. */
export const emojiRenderer: ReactionRenderer = {
  id: 'emoji',
  label: 'Emoji',
  component: EmojiFace,
  dev: true,
}
