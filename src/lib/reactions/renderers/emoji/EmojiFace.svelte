<script lang="ts">
  import type { ReactionViewProps } from '../../types'
  import { resolveEmoji } from './mapping'

  let {
    result = null,
    listening = false,
    reacting = false,
    bobbing = false,
    speaking = false,
    voiceMouthOpen = 0,
  }: ReactionViewProps = $props()

  const emoji = $derived(resolveEmoji({ result, listening, reacting, speaking, voiceMouthOpen }))
  const label = $derived(
    reacting && result ? `${result.emotion} ${result.tone}` : listening ? 'listening' : 'neutral',
  )
</script>

<!-- Outer span carries the idle float, inner span the reacting scale, so the
     two transforms never fight over the same element. -->
<span class="inline-block {bobbing && !reacting ? 'jev-float' : ''}">
  <span
    class="block text-6xl leading-none transition-transform duration-500 {reacting
      ? 'scale-110'
      : 'scale-100'}"
    role="img"
    aria-label={label}
  >
    {emoji}
  </span>
</span>
