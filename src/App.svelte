<script lang="ts">
  import { m } from './lib/paraglide/messages'
  import { getLocale, setLocale, locales, type Locale } from './lib/paraglide/runtime'
  import {
    evaluateComplexReaction,
    type ReactionResult,
  } from './lib/emotion'
  import { debugLog, type DebugEntry } from './lib/debug.svelte'

  let locale = $state(getLocale())

  let text = $state('')
  let loading = $state(false)
  let result = $state<ReactionResult | null>(null)
  let error = $state('')

  // Debug console state: collapsed by default, expands over the lower half of
  // the viewport. It overlays the main area, so expanding it never shifts layout.
  const DEBUG_FILTERS = ['all', 'pending', 'error'] as const
  type DebugFilter = (typeof DEBUG_FILTERS)[number]
  let debugOpen = $state(false)
  let debugFilter = $state<DebugFilter>('all')

  // Avatar: 😐 when the input is empty, � (minimum curiosity) while there is
  // text, and a reaction emoji held for MIN_HOLD_MS once a result arrives.
  const NEUTRAL_EMOJI = '😐'
  const LISTENING_EMOJI = '🙂'
  const MIN_HOLD_MS = 2500
  const PANIC_INTENSITY = 4

  let displayEmoji = $state(NEUTRAL_EMOJI)
  let reacting = $state(false)
  // Non-reactive on purpose: reading these inside the debounce $effect would re-trigger it.
  let held: ReactionResult | null = null
  let queued: ReactionResult | null = null
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let lastAnalyzed = ''

  // A request is in flight; a newer analyze was requested and will re-run after.
  let pendingRerun = false

  const idleEmoji = () => (text.trim() ? LISTENING_EMOJI : NEUTRAL_EMOJI)

  function showReaction(res: ReactionResult) {
    held = res
    queued = null
    result = res
    displayEmoji = res.emoji
    reacting = true
    clearTimeout(holdTimer)
    holdTimer = setTimeout(releaseHold, MIN_HOLD_MS)
  }

  function releaseHold() {
    holdTimer = undefined
    if (queued) {
      showReaction(queued)
      return
    }
    held = null
    reacting = false
    displayEmoji = idleEmoji()
  }

  // Only a clearly stronger reaction may cut a hold short; anything else waits its turn.
  function receiveReaction(res: ReactionResult) {
    if (!held || (res.intensity >= PANIC_INTENSITY && res.intensity > held.intensity)) {
      showReaction(res)
    } else {
      queued = res
    }
  }

  $effect(() => () => clearTimeout(holdTimer))

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function clearDebounce() {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
  }

  // Auto-analyze 300ms after the user stops typing. No word-completeness check:
  // Jev is an LLM and handles incomplete words / partial phrases fine — the
  // debounce alone is enough to avoid firing on every keystroke.
  $effect(() => {
    const value = text.trim()
    clearDebounce()
    if (!value) {
      queued = null
      lastAnalyzed = ''
    }
    if (!held) displayEmoji = value ? LISTENING_EMOJI : NEUTRAL_EMOJI
    if (!value || value === lastAnalyzed) return
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      void analyze()
    }, 300)
    return clearDebounce
  })

  async function analyze() {
    const input = text.trim()
    if (!input || input === lastAnalyzed) return

    // If a request is already in flight, don't fire a second one — mark that a
    // newer analysis is wanted and let the running one re-run when it finishes.
    if (loading) {
      pendingRerun = true
      return
    }

    clearDebounce()
    lastAnalyzed = input
    loading = true
    error = ''

    try {
      receiveReaction(await evaluateComplexReaction(input))
    } catch (e) {
      error = e instanceof Error && e.message === 'MISSING_KEY'
        ? m.emotion_error_no_key()
        : m.emotion_error_failed()
    } finally {
      loading = false
      // Text changed while we were waiting — analyze the latest version now
      if (pendingRerun) {
        pendingRerun = false
        void analyze()
      }
    }
  }

  function switchLocale(next: Locale) {
    if (next === locale) return
    setLocale(next)
    locale = next
  }

  // Derived: entries after applying the current filter
  const filteredEntries = $derived(
    debugLog.entries.filter((e) => {
      if (debugFilter === 'pending') return e.status === undefined && !e.error
      if (debugFilter === 'error') return e.error !== undefined || (e.status !== undefined && e.status >= 400)
      return true
    }),
  )

  const pendingCount = $derived(debugLog.entries.filter((e) => e.status === undefined && !e.error).length)
  const errorCount = $derived(
    debugLog.entries.filter((e) => e.error !== undefined || (e.status !== undefined && e.status >= 400)).length,
  )

  function statusColor(e: DebugEntry): string {
    if (e.error) return 'text-red-400'
    if (e.status === undefined) return 'text-amber-300 animate-pulse'
    if (e.status >= 400) return 'text-red-400'
    return 'text-emerald-400'
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour12: false })
  }
</script>

<!-- App shell: fixed viewport height, header on top, main content in the
     middle, debug console docked at the bottom. Nothing scrolls at the page
     level, so nothing ever jumps. -->
<div class="flex h-dvh flex-col overflow-hidden bg-gray-950 text-gray-100">
  <!-- Header -->
  <header class="flex h-14 shrink-0 items-center justify-between border-b border-gray-800 bg-gray-900/80 px-4 backdrop-blur">
    <h1 class="text-lg font-bold tracking-tight">{m.hello({ name: 'Jev' })}</h1>

    <div class="flex items-center gap-3">
      {#if loading}
        <span class="flex items-center gap-1.5 text-xs text-gray-400" role="status">
          <span class="inline-block size-2 animate-pulse rounded-full bg-indigo-400"></span>
          {m.emotion_analyzing()}
        </span>
      {/if}

      <!-- Locale switcher -->
      <div
        class="flex overflow-hidden rounded-lg border border-gray-700 bg-gray-950 text-sm"
        role="group"
        aria-label="Language"
      >
        {#each locales as loc (loc)}
          <button
            class="px-3 py-1.5 font-medium uppercase transition {locale === loc
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}"
            aria-pressed={locale === loc}
            onclick={() => switchLocale(loc)}
          >
            {loc}
          </button>
        {/each}
      </div>
    </div>
  </header>

  <!-- Main content: the only scrollable region -->
  <main class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex h-full max-w-xl flex-col justify-center gap-6 px-4 py-6">
      <section class="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <h2 class="mb-4 text-xl font-semibold">{m.emotion_title()}</h2>
        <textarea
          class="min-h-24 w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-gray-100 placeholder-gray-500 outline-none transition focus:border-indigo-500"
          bind:value={text}
          placeholder={m.emotion_placeholder()}
        ></textarea>

        {#if error}
          <p class="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</p>
        {/if}

        <div class="mt-5 space-y-4">
          <div class="flex flex-col items-center gap-3">
            <span
              class="text-6xl leading-none transition-transform duration-500 {reacting ? 'scale-110' : 'scale-100'}"
              role="img"
              aria-label={result ? '{result.emotion} {result.tone}' : 'neutral'}
            >
              {displayEmoji}
            </span>
            {#if result}
              <div class="flex flex-wrap items-center justify-center gap-2">
                <span class="rounded-full bg-indigo-600/20 px-4 py-1.5 text-sm font-semibold text-indigo-300 capitalize">
                  {result.emotion}
                </span>
                <span class="rounded-full bg-purple-600/20 px-4 py-1.5 text-sm font-semibold text-purple-300 capitalize">
                  {result.tone}
                </span>
              </div>
            {/if}
          </div>

          {#if result}
            <div>
              <div class="mb-1.5 flex justify-between text-sm text-gray-400">
                <span>{m.emotion_intensity()}</span>
                <span class="font-medium text-gray-200">{result.intensity}/5</span>
              </div>
              <div class="flex gap-1" role="meter" aria-valuenow={result.intensity} aria-valuemin={1} aria-valuemax={5}>
                {#each Array.from({ length: 5 }, (_, i) => i + 1) as segment (segment)}
                  <div
                    class="h-2.5 flex-1 rounded-full transition-colors {segment <= result.intensity ? 'bg-indigo-500' : 'bg-gray-800'}"
                  ></div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </section>

      <p class="text-center text-sm text-gray-500">{m.welcome()}</p>
    </div>
  </main>

  <!-- Debug console: docked to the bottom, overlays main when open -->
  <section
    class="flex shrink-0 flex-col border-t border-gray-800 bg-gray-900/95 backdrop-blur transition-[height] duration-300 {debugOpen
      ? 'h-[50dvh]'
      : 'h-11'}"
    aria-label="Debug console"
  >
    <!-- Console toolbar -->
    <div class="flex h-11 shrink-0 items-center justify-between gap-2 px-4">
      <button
        class="flex items-center gap-2 text-sm font-medium text-gray-300 hover:text-white"
        onclick={() => (debugOpen = !debugOpen)}
        aria-expanded={debugOpen}
      >
        <span class="transition-transform duration-200 {debugOpen ? 'rotate-180' : ''}">▾</span>
        {m.debug_title()}
        <span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">{debugLog.entries.length}</span>
        {#if pendingCount > 0}
          <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">{pendingCount}</span>
        {/if}
        {#if errorCount > 0}
          <span class="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-300">{errorCount}</span>
        {/if}
      </button>

      <div class="flex items-center gap-2">
        {#if debugOpen}
          <div class="flex overflow-hidden rounded-md border border-gray-700 text-xs" role="group">
            {#each DEBUG_FILTERS as f (f)}
              <button
                class="px-2 py-1 transition {debugFilter === f
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:bg-gray-800'}"
                onclick={() => (debugFilter = f)}
              >
                {m[`debug_filter_${f}`]()}
              </button>
            {/each}
          </div>
          <button
            class="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
            onclick={() => debugLog.clear()}
          >
            {m.debug_clear()}
          </button>
        {/if}
      </div>
    </div>

    {#if debugOpen}
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {#if filteredEntries.length === 0}
          <p class="py-6 text-center text-sm text-gray-600">{m.debug_empty()}</p>
        {:else}
          <ol class="space-y-2">
            {#each filteredEntries as entry (entry.id)}
              <li class="rounded-lg border border-gray-800 bg-gray-950/80 text-xs">
                <!-- Request summary row -->
                <details>
                  <summary class="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 hover:bg-gray-900">
                    <span class="font-mono {statusColor(entry)}">
                      {#if entry.status !== undefined}
                        {entry.status}
                      {:else if entry.error}
                        ERR
                      {:else}
                        …
                      {/if}
                    </span>
                    <span class="font-mono font-semibold text-gray-300">{entry.method}</span>
                    <span class="min-w-0 flex-1 truncate font-mono text-gray-500">{entry.url}</span>
                    {#if entry.durationMs !== undefined}
                      <span class="font-mono text-gray-500">{entry.durationMs}ms</span>
                    {/if}
                    <span class="font-mono text-gray-600">{formatTime(entry.startedAt)}</span>
                  </summary>
                  <div class="space-y-2 border-t border-gray-800/60 px-3 py-2">
                    <div>
                      <p class="mb-1 font-semibold uppercase tracking-wide text-gray-500">{m.debug_request()}</p>
                      <pre class="overflow-x-auto whitespace-pre-wrap break-all text-gray-400">{entry.requestBody || '—'}</pre>
                    </div>
                    <div>
                      <p class="mb-1 font-semibold uppercase tracking-wide text-gray-500">{m.debug_response()}</p>
                      {#if entry.error}
                        <pre class="overflow-x-auto whitespace-pre-wrap break-all text-red-400">{entry.error}</pre>
                      {:else if entry.responseBody !== undefined}
                        <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all text-gray-400">{entry.responseBody}</pre>
                      {:else}
                        <pre class="text-amber-300">{m.debug_pending()}</pre>
                      {/if}
                    </div>
                  </div>
                </details>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    {/if}
  </section>
</div>