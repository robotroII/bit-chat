<script lang="ts">
  import { onMount } from 'svelte'
  import { Kugutu, type CharacterPlayer } from '@kugutu/runtime-web'
  import type { ReactionViewProps } from '../../types'
  import { buildJevPack, resolveKugutuDirection } from './mapping'

  let { result = null, listening = false, reacting = false, bobbing = false }: ReactionViewProps =
    $props()

  const pack = buildJevPack()

  let container = $state<HTMLDivElement | null>(null)
  let player = $state<CharacterPlayer | null>(null)
  let loadError = $state(false)

  onMount(() => {
    if (!container) return
    let disposed = false
    let loaded: CharacterPlayer | null = null
    Kugutu.load(pack, container, { random: Math.random })
      .then((p) => {
        if (disposed) {
          p.destroy()
          return
        }
        loaded = p
        player = p
      })
      .catch(() => {
        loadError = true
      })
    return () => {
      disposed = true
      loaded?.destroy()
      player = null
    }
  })

  // Drive the actor from the reaction state. Re-runs when the player finishes
  // loading ($state) or any prop changes.
  let lastGestureKey = ''
  $effect(() => {
    const p = player
    if (!p) return
    const dir = resolveKugutuDirection({ result, listening, reacting })
    p.setEmotion(dir.emotion, dir.intensity)
    p.setPart('mouth', dir.mouth)
    p.setMouthOpen(dir.mouthOpen)
    p.lookAt(dir.lookAt)
    // Gestures are one-shots: only replay when the reaction actually changed.
    const key = result ? `${result.emotion}|${result.tone}|${result.intensity}` : ''
    if (dir.gesture && reacting && key !== lastGestureKey) {
      lastGestureKey = key
      p.playGesture(dir.gesture)
    }
  })

  const scale = $derived(reacting ? 1.08 : 1)
  const label = $derived(
    reacting && result ? `jev ${result.emotion} ${result.tone}` : 'jev neutral',
  )
</script>

<!--
  Jev — Cartman-like Kugutu character (rig adapted from jeeliz/jeelizWeboji
  demos/svg, Apache-2.0; character runtime by @kugutu/runtime-web, MIT).
  South Park likeness: demo use only.
-->
<div class="transition-transform duration-500" style:transform={`scale(${scale})`}>
  <div
    bind:this={container}
    class="h-40 [&>svg]:h-full [&>svg]:w-auto {bobbing && !reacting ? 'jev-bob' : ''}"
    role="img"
    aria-label={label}
  ></div>
  {#if loadError}
    <span class="text-xs text-red-400">kugutu failed to load</span>
  {/if}
</div>
