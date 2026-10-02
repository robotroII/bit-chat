import { cartmanRenderer } from './renderers/cartman'
import { emojiRenderer } from './renderers/emoji'
import { kugutuRenderer } from './renderers/kugutu'
import { tronRenderer } from './renderers/tron'
import { vrmRenderer } from './renderers/vrm'
import type { ReactionRenderer } from './types'

/**
 * Register new avatar integrations here: create
 * `renderers/<id>/` exporting a ReactionRenderer, then add it to this list.
 */
const ALL_RENDERERS: readonly ReactionRenderer[] = [
  emojiRenderer,
  cartmanRenderer,
  kugutuRenderer,
  tronRenderer,
  vrmRenderer,
]

const SELECTED_STORAGE_KEY = 'jev:renderer'
const DEFAULT_RENDERER_ID = 'cartman'

class ReactionRendererRegistry {
  /** Id of the renderer currently displayed (persisted across reloads). */
  selectedId = $state<string>(localStorage.getItem(SELECTED_STORAGE_KEY) ?? DEFAULT_RENDERER_ID)

  /** Dev toggle: display the emoji renderer instead of the selected avatar. */
  emojiDevMode = $state(false)

  constructor() {
    // Guard against stale ids persisted by older app versions.
    if (!ALL_RENDERERS.some((r) => r.id === this.selectedId)) {
      this.selectedId = DEFAULT_RENDERER_ID
    }
  }

  /** Renderers offered in the picker (dev-only ones excluded). */
  get selectable(): ReactionRenderer[] {
    return ALL_RENDERERS.filter((r) => !r.dev)
  }

  /** The single renderer currently displayed. */
  get active(): ReactionRenderer {
    if (this.emojiDevMode) return emojiRenderer
    return ALL_RENDERERS.find((r) => r.id === this.selectedId) ?? this.selectable[0]!
  }

  select(id: string): void {
    if (!this.selectable.some((r) => r.id === id)) return
    this.selectedId = id
    localStorage.setItem(SELECTED_STORAGE_KEY, id)
  }
}

export const rendererRegistry = new ReactionRendererRegistry()
