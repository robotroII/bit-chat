<script lang="ts">
  import { m } from './lib/paraglide/messages'
  import { getLocale, setLocale, locales, type Locale } from './lib/paraglide/runtime'
  import {
    evaluateComplexReaction,
    type ReactionResult,
  } from './lib/emotion'
  import { sendChatMessage, type ChatMessage } from './lib/chat'
  import { debugLog, type DebugEntry } from './lib/debug.svelte'
  import { rendererRegistry } from './lib/reactions/registry.svelte'
  import { voice } from './lib/voice.svelte'

  let locale = $state(getLocale())

  let text = $state('')
  let loading = $state(false)
  let result = $state<ReactionResult | null>(null)
  let error = $state('')

  // Chat with the larger LLM: its reply is printed in the transcript AND fed
  // back into the emotion pipeline, so the avatar reacts to what Jev says.
  let chatMessages = $state<ChatMessage[]>([])
  let sending = $state(false)
  let chatError = $state('')
  let transcriptEl: HTMLElement | undefined = $state()

  // True while the user is typing OR talking, or while Jev is thinking
  // (waiting for the LLM reply) — renderers show their listening/thinking
  // face.
  const listening = $derived(text.trim().length > 0 || voice.micActive || sending)

  // Idle bobbing preference (opt-in), persisted across reloads.
  const BOBBING_STORAGE_KEY = 'jev:bobbing'
  let bobbing = $state(localStorage.getItem(BOBBING_STORAGE_KEY) === 'true')
  $effect(() => {
    localStorage.setItem(BOBBING_STORAGE_KEY, String(bobbing))
  })

  // Debug console state: collapsed by default, expands over the lower half of
  // the viewport. It overlays the main area, so expanding it never shifts layout.
  const DEBUG_FILTERS = ['all', 'pending', 'error'] as const
  type DebugFilter = (typeof DEBUG_FILTERS)[number]
  let debugOpen = $state(false)
  let debugFilter = $state<DebugFilter>('all')

  // A reaction is held on screen for 2.5s (intensity 1) to 6s (intensity 5).
  // The idle/listening faces are chosen by each renderer (src/lib/reactions/).
  const MIN_HOLD_MS = 2500
  const MAX_HOLD_MS = 6000
  const PANIC_INTENSITY = 4

  let reacting = $state(false)
  // Non-reactive on purpose: reading these inside the debounce $effect would re-trigger it.
  let held: ReactionResult | null = null
  let queued: ReactionResult | null = null
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let lastAnalyzed = ''

  // A request is in flight; a newer analyze was requested and will re-run after.
  let pendingRerun = false

  function showReaction(res: ReactionResult) {
    held = res
    queued = null
    result = res
    reacting = true
    clearTimeout(holdTimer)
    holdTimer = setTimeout(releaseHold, MIN_HOLD_MS + ((res.intensity - 1) / 4) * (MAX_HOLD_MS - MIN_HOLD_MS))
  }

  function releaseHold() {
    holdTimer = undefined
    if (queued) {
      showReaction(queued)
      return
    }
    // Jev is still talking: keep the current emotion on screen (re-armed in
    // chunks) instead of dropping to a static neutral face mid-speech — the
    // speech-end hook resets everything once he's done.
    if (voice.speaking) {
      holdTimer = setTimeout(releaseHold, MIN_HOLD_MS)
      return
    }
    held = null
    reacting = false
  }

  // Only a clearly stronger reaction may cut a hold short; anything else waits its turn.
  // Exception: the same emotion+tone REPLACES the current reaction instead of
  // queueing — rapid-fire voice analyses would otherwise drain an endless
  // chain of near-identical holds, freezing the avatar in one emotion long
  // past the max hold time.
  // `immediate` bypasses the queue entirely for live signals (mic open, the
  // user's own typed words): the latest input always shows at once.
  function receiveReaction(res: ReactionResult, opts: { immediate?: boolean } = {}) {
    // While the user is still talking, reactions are live previews: the
    // latest analysis always wins, so the face keeps updating mid-speech
    // instead of stacking a queue that drains after the pause.
    if (voice.micActive || opts.immediate) {
      showReaction(res)
      return
    }
    if (held && res.emotion === held.emotion && res.tone === held.tone) {
      if (queued && queued.emotion === res.emotion && queued.tone === res.tone) queued = null
      showReaction(res)
      return
    }
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
      // The user's own words always react immediately (latest-wins, like
      // the mid-speech mic preview) — queueing them behind a hold made
      // typed input feel ignored whenever a previous reaction was held.
      receiveReaction(await evaluateComplexReaction(input), { immediate: true })
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

  // Submit the transcript to the larger LLM. The reply is shown in the chat
  // and its text is analyzed like any other input, so the avatar reacts to
  // Jev's answer through the existing hold-queue (receiveReaction).
  async function sendToLlm() {
    const input = text.trim()
    if (!input || sending) return

    // Flush a pending debounce instead of cancelling it: Enter within 300ms
    // of the last keystroke would otherwise skip the user's own emotion
    // analysis entirely (only the reply would ever drive the avatar). The
    // flushed analysis shows the user's emotion while Jev thinks.
    if (debounceTimer !== undefined) {
      clearDebounce()
      void analyze()
    }
    text = ''
    chatError = ''
    chatMessages = [...chatMessages, { role: 'user', content: input }]
    sending = true

    let reply: string
    try {
      reply = await sendChatMessage(chatMessages)
      chatMessages = [...chatMessages, { role: 'assistant', content: reply }]
    } catch (e) {
      chatError = e instanceof Error && e.message === 'MISSING_KEY'
        ? m.emotion_error_no_key()
        : m.chat_error_failed()
      return
    } finally {
      sending = false
    }

    // The reply drives the avatar: same pipeline as user-typed text. A
    // failure here must not erase the reply — the avatar just keeps its
    // current face until the next reaction.
    let reaction: ReactionResult | null = null
    try {
      reaction = await evaluateComplexReaction(reply)
      receiveReaction(reaction)
    } catch {
      /* ignore */
    }

    // Speak the reply once the emotion is known, so pitch/rate match it.
    voice.speak(reply, reaction)
  }

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendToLlm()
    }
  }

  // Voice: a completed spoken utterance lands in the textarea and is sent
  // straight to the LLM (hands-free loop). sendToLlm reads `text`, so set it
  // first; it also clears the pending debounce, so no double-send.
  voice.onUtterance = (utterance) => {
    text = utterance
    void sendToLlm()
  }

  // While the mic is live, mirror the growing transcript into the textarea:
  // the user sees what's recognized and the avatar can react mid-speech.
  $effect(() => {
    if (!voice.micActive) return
    const live = `${voice.finalText} ${voice.interim}`.trim()
    if (live) text = live
  })

  // When Jev finishes talking, FULLY reset the reaction state — never pop
  // the queue. Popping here would start a fresh hold AFTER the speech (the
  // frozen open mouth); whatever is queued at that point is stale, and the
  // face should relax once Jev is done talking.
  voice.onSpeechEnd = () => {
    clearTimeout(holdTimer)
    holdTimer = undefined
    queued = null
    held = null
    reacting = false
  }

  // Mid-speech analysis on a fixed cadence. The typing debounce resets on
  // every text change, and voice interims arrive faster than 300ms — the
  // timer would starve and never fire. analyze() no-ops when the text
  // hasn't changed, so a steady interval is safe.
  let voiceAnalyzeTimer: ReturnType<typeof setInterval> | undefined
  $effect(() => {
    if (!voice.micActive || voiceAnalyzeTimer) return
    voiceAnalyzeTimer = setInterval(() => {
      if (voice.micActive) void analyze()
    }, 1500)
    return () => {
      clearInterval(voiceAnalyzeTimer)
      voiceAnalyzeTimer = undefined
    }
  })

  function toggleMic() {
    if (voice.micActive) {
      // Clicking the mic again commits immediately — no need to wait out
      // the silence window.
      voice.stopListening(true)
    } else {
      void voice.startListening()
    }
  }

  // Map raw SpeechRecognition error codes to actionable guidance.
  function micErrorMessage(code: string): string {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return m.voice_error_blocked()
      case 'audio-capture':
        return m.voice_error_no_mic()
      case 'network':
        return m.voice_error_network()
      default:
        return `${m.voice_error()} (${code})`
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

  // Keep the transcript pinned to the newest message.
  $effect(() => {
    void chatMessages.length
    transcriptEl?.scrollTo({ top: transcriptEl.scrollHeight })
  })

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

  <!-- Main: chat history fills the left, avatar panel (~38% width, full
       height → portrait/skyscraper) docks the right. Both regions scroll
       internally; the page itself never scrolls. -->
  <main class="flex min-h-0 flex-1">
    <!-- Chat transcript: user messages right, Jev's replies left. The
         reply is also fed into the emotion pipeline (see sendToLlm). -->
    <section class="flex min-h-0 flex-1 flex-col px-4 py-4">
      <div
        bind:this={transcriptEl}
        class="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-3 overflow-y-auto pr-1"
        aria-live="polite"
      >
        {#if chatMessages.length === 0 && !sending}
          <p class="pt-10 text-center text-sm text-gray-500">{m.welcome()}</p>
        {/if}
            {#each chatMessages as msg, i (i)}
              <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
                <div
                  class="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed {msg.role === 'user'
                    ? 'rounded-br-sm bg-indigo-600 text-white'
                    : 'rounded-bl-sm bg-gray-800 text-gray-100'}"
                >
                  {#if msg.role === 'assistant'}
                    <p class="mb-0.5 text-xs font-semibold text-indigo-300">Jev</p>
                  {/if}
                  <p class="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            {/each}
            {#if sending}
              <div class="flex justify-start">
                <div class="rounded-2xl rounded-bl-sm bg-gray-800 px-4 py-3" aria-label={m.chat_thinking()}>
                  <span class="flex items-center gap-1.5">
                    <span class="size-2 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.3s]"></span>
                    <span class="size-2 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.15s]"></span>
                    <span class="size-2 animate-bounce rounded-full bg-gray-500"></span>
                  </span>
                </div>
              </div>
            {/if}
      </div>
    </section>

    <!-- Avatar panel: ~38% width, full main height → portrait/skyscraper.
         The renderer is picked via the dropdown in the dock below; keyed
         each = remount on switch (clean player lifecycle). -->
    <aside class="flex min-h-0 w-[38%] min-w-[300px] shrink-0 flex-col items-center justify-center gap-5 overflow-hidden border-l border-gray-800 bg-gray-900/40 px-4">
      {#each [rendererRegistry.active] as r (r.id)}
        {@const Active = r.component}
        <Active {result} {listening} {reacting} {bobbing} speaking={voice.speaking} voiceMouthOpen={voice.mouthOpen} micLevel={voice.micLevel} />
      {/each}
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
    </aside>
  </main>

  <!-- Bottom dock: input row on top; intensity bar + controls beneath it;
       the debug console (collapsed by default) stays at the very bottom. -->
  <footer class="shrink-0 border-t border-gray-800 bg-gray-900/80 px-4 py-3 backdrop-blur">
    <div class="mx-auto max-w-3xl">
        <!-- Input row: typing keeps the quick-reaction path; Enter/Send
             submits to the larger LLM. The mic starts speech recognition;
             a 1.2s silence auto-sends the utterance. -->
        <div class="flex items-end gap-2">
          {#if voice.sttSupported}
            <button
              type="button"
              class="relative shrink-0 rounded-lg border px-3 py-3 transition {voice.micActive
                ? 'border-red-500 bg-red-950/60 text-red-300'
                : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-indigo-500 hover:text-indigo-300'}"
              onclick={toggleMic}
              aria-pressed={voice.micActive}
              title={voice.micActive ? m.voice_listening() : m.voice_mic()}
            >
              🎤
              {#if voice.micActive}
                <span class="absolute -right-1 -top-1 size-3 animate-ping rounded-full bg-red-500"></span>
                <span class="absolute -right-1 -top-1 size-3 rounded-full bg-red-500"></span>
              {/if}
            </button>
          {/if}
          <textarea
            class="min-h-12 flex-1 resize-y rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-gray-100 placeholder-gray-500 outline-none transition focus:border-indigo-500"
            bind:value={text}
            onkeydown={onChatKeydown}
            placeholder={voice.micActive ? m.voice_listening() : m.emotion_placeholder()}
          ></textarea>
          <button
            class="shrink-0 rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            onclick={() => void sendToLlm()}
            disabled={!text.trim() || sending}
          >
            {m.chat_send()}
          </button>
        </div>

        {#if voice.micActive}
          <!-- Live mic level: moves while the recognizer hears audio. A flat
               bar means the selected input device is silent, muted or wrong. -->
          <div class="mt-2 h-1 overflow-hidden rounded-full bg-gray-800" aria-hidden="true">
            <div
              class="h-full rounded-full bg-emerald-500 transition-[width] duration-100"
              style:width={`${Math.round(voice.micLevel * 100)}%`}
            ></div>
          </div>
        {/if}

        {#if chatError}
          <p class="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">{chatError}</p>
        {/if}

        {#if voice.micError}
          <p class="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {micErrorMessage(voice.micError)}
          </p>
        {/if}

        {#if error}
          <p class="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</p>
        {/if}

        <!-- Intensity bar + renderer/voice controls beneath the input. -->
        <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          {#if result}
            <div class="min-w-52 flex-1">
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

          <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-gray-400">
            <label class="flex items-center gap-2">
              <span>{m.emotion_renderer()}</span>
              <select
                class="rounded-lg border border-gray-700 bg-gray-950 px-2 py-1 text-gray-200 outline-none transition focus:border-indigo-500"
                value={rendererRegistry.selectedId}
                onchange={(e) => rendererRegistry.select(e.currentTarget.value)}
              >
                {#each rendererRegistry.selectable as r (r.id)}
                  <option value={r.id}>{r.label}</option>
                {/each}
              </select>
            </label>
            <label class="flex items-center gap-2">
              <input type="checkbox" bind:checked={rendererRegistry.emojiDevMode} class="size-4 accent-indigo-500" />
              {m.emotion_dev_emoji()}
            </label>
            <label class="flex items-center gap-2">
              <input type="checkbox" bind:checked={bobbing} class="size-4 accent-indigo-500" />
              {m.emotion_bobbing()}
            </label>
            {#if voice.ttsSupported}
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={voice.ttsEnabled}
                  onchange={() => voice.toggleTts()}
                  class="size-4 accent-indigo-500"
                />
                {m.voice_speak_toggle()}
              </label>
              {#if voice.speaking}
                <button
                  type="button"
                  class="rounded-lg border border-gray-700 px-2 py-1 text-gray-300 transition hover:border-red-500 hover:text-red-300"
                  onclick={() => voice.stopSpeaking()}
                >
                  {m.voice_stop()}
                </button>
              {/if}
            {/if}
          </div>
        </div>
    </div>
  </footer>

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