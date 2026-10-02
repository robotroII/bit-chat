import type { Component } from 'svelte'
import type { ReactionResult } from '../emotion'

/** Everything a renderer needs to draw the current state of the reaction UI. */
export interface ReactionViewProps {
  /** Latest analysis result; null while nothing has been analyzed yet. */
  result: ReactionResult | null
  /** True while the user is typing (pre-analysis "listening" state). */
  listening: boolean
  /** True while a reaction is held on screen (the hold window). */
  reacting: boolean
  /** Idle bobbing animation, opt-in user preference. */
  bobbing: boolean
  /** True while Jev is speaking a reply out loud (TTS active). */
  speaking: boolean
  /** Lip-sync amplitude 0..1 while Jev speaks; 0 otherwise. */
  voiceMouthOpen: number
  /** Live microphone input level 0..1 while the user talks; 0 otherwise. */
  micLevel: number
}

/**
 * A pluggable visual renderer for reaction results.
 * Ship one per avatar integration (emoji, cartman, kugutu, voqalize, …):
 * create `renderers/<id>/` with a mapping module + component, export a
 * ReactionRenderer from `renderers/<id>/index.ts`, and register it in
 * `registry.svelte.ts`.
 */
export interface ReactionRenderer {
  /** Stable id used for selection bookkeeping. */
  id: string
  /** Human-readable name shown in the renderer picker. */
  label: string
  /** Svelte component implementing ReactionViewProps. */
  component: Component<ReactionViewProps>
  /** Dev-only renderers are hidden from the picker behind a dev toggle. */
  dev?: boolean
}
