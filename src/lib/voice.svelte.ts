import { getLocale } from './paraglide/runtime'
import type { ReactionResult } from './emotion'

/**
 * Voice interface for the avatar: speech-to-text input (Web Speech API
 * SpeechRecognition) + spoken replies (speechSynthesis) + a lip-sync
 * amplitude envelope that renderers consume via ReactionViewProps.
 *
 * Singleton runes module, same pattern as registry.svelte.ts. No new
 * dependencies — everything is a browser built-in. Firefox has no
 * SpeechRecognition (sttSupported is false → the UI hides the mic);
 * speechSynthesis is supported everywhere modern.
 */

// Silence window before an utterance is considered complete and sent.
const SILENCE_MS = 900
// Lip-sync envelope decay: mouthOpen halves roughly every 120ms after a word.
const MOUTH_DECAY_PER_SEC = 0.5 ** (1 / (0.12 * 60))
// Fallback flapping frequency when the browser fires no word boundaries.
const FLAP_HZ = 6.5

const TTS_STORAGE_KEY = 'jev:tts'

/** Speech parameters per emotion — how Jev's voice colors his replies. */
const VOICE_BY_EMOTION: Record<
  ReactionResult['emotion'],
  { rate: number; pitch: number }
> = {
  happy: { rate: 1.1, pitch: 1.15 },
  sad: { rate: 0.85, pitch: 0.9 },
  angry: { rate: 1.05, pitch: 0.95 },
  surprised: { rate: 1.1, pitch: 1.2 },
  terrified: { rate: 1.15, pitch: 1.1 },
  curious: { rate: 1.0, pitch: 1.05 },
  suspicious: { rate: 0.95, pitch: 0.9 },
  neutral: { rate: 1.0, pitch: 1.0 },
}

class VoiceController {
  // ── Reactive state ──────────────────────────────────────────────────────
  /** True while the recognizer is running. */
  micActive = $state(false)
  /** Live interim transcript (not yet finalized by the recognizer). */
  interim = $state('')
  /** Accumulated final segments of the current utterance. */
  finalText = $state('')
  /** Last recognition error message (empty = none). */
  micError = $state('')
  /** Live input level 0..1 while listening (RMS of the mic stream). A flat
   *  zero means the selected input device is silent, muted or wrong. */
  micLevel = $state(0)
  /** True while Jev is speaking a reply out loud. */
  speaking = $state(false)
  /** Lip-sync amplitude 0..1, driven by the speech envelope. */
  mouthOpen = $state(0)
  /** Speak replies out loud (opt-in, persisted). */
  ttsEnabled = $state(localStorage.getItem(TTS_STORAGE_KEY) === 'true')

  /** Callback invoked with the completed utterance when the silence timer fires. */
  onUtterance: ((text: string) => void) | null = null
  /** Callback invoked when Jev finishes speaking (natural end, error,
   *  watchdog or hard timeout). The app releases the reaction hold so the
   *  avatar relaxes instead of freezing in the emotion's open-mouth pose. */
  onSpeechEnd: (() => void) | null = null

  // ── Capability probes ───────────────────────────────────────────────────
  get sttSupported(): boolean {
    return typeof window !== 'undefined' && 'webkitSpeechRecognition' in window
  }

  get ttsSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  // ── Non-reactive internals ──────────────────────────────────────────────
  private recognition: SpeechRecognition | null = null
  private silenceTimer: ReturnType<typeof setTimeout> | undefined
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private rafId = 0
  private envelopeTarget = 0
  private lastEnvelopeTime = 0
  private sawBoundary = false
  /** True while the user wants the mic on (across recognizer restarts). */
  private wantListening = false
  private micStream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private levelData = new Uint8Array(2048)
  private levelRafId = 0
  /** Keep the utterance referenced — Chrome stops firing events (and can
   *  drop onend entirely) if the SpeechSynthesisUtterance is GC'd. */
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private speakTimeout: ReturnType<typeof setTimeout> | undefined

  // ── Speech recognition (mic) ────────────────────────────────────────────

  async startListening(): Promise<void> {
    if (this.wantListening || !this.sttSupported) return
    // Talking over Jev: cut his speech so the mic hears the user.
    this.stopSpeaking()

    const Ctor = window.webkitSpeechRecognition
    if (!Ctor) return

    // Preflight: request mic access explicitly. This surfaces the real
    // permission prompt (SpeechRecognition alone can fail with a bare
    // "not-allowed" when the site/OS permission was denied before) and
    // distinguishes "no device" from "permission denied". The stream stays
    // open while listening — it feeds the live level meter.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.micStream = stream
      console.info('[voice] mic:', stream.getAudioTracks()[0]?.label || 'unknown device')
      this.startLevelMeter(stream)
    } catch (e) {
      console.info('[voice] getUserMedia preflight failed:', e)
      this.micError =
        e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError')
          ? 'audio-capture'
          : 'not-allowed'
      return
    }

    this.wantListening = true
    this.micActive = true
    this.finalText = ''
    this.interim = ''
    this.micError = ''
    this.startRecognition()
  }

  private startRecognition(): void {
    const Ctor = window.webkitSpeechRecognition
    if (!Ctor) return

    const rec = new Ctor()
    rec.lang = localeToBcp47(getLocale())
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      console.info('[voice] recognition started', rec.lang)
      this.micError = ''
    }
    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        const alt = res[0]
        if (!alt) continue
        if (res.isFinal) {
          this.finalText = `${this.finalText} ${alt.transcript}`.trim()
        } else {
          interim += alt.transcript
        }
      }
      this.interim = interim
      // Any new audio resets the end-of-utterance silence timer.
      this.restartSilenceTimer()
    }
    rec.onerror = (event) => {
      console.info('[voice] recognition error:', event.error)
      // no-speech / aborted are normal lifecycle noise (Chrome ends the
      // session after ~8s of silence); everything else is fatal.
      const fatal = event.error !== 'no-speech' && event.error !== 'aborted'
      if (fatal) {
        this.micError = event.error
        this.wantListening = false
      }
    }
    rec.onend = () => {
      console.info('[voice] recognition ended')
      this.recognition = null
      this.interim = ''
      // Chrome ends the session after ~8s of silence — restart while the
      // user still wants to listen, so the mic stays hands-free.
      if (this.wantListening) {
        this.clearRestartTimer()
        this.restartTimer = setTimeout(() => {
          if (this.wantListening) this.startRecognition()
        }, 250)
      } else {
        this.micActive = false
      }
    }

    this.recognition = rec
    try {
      rec.start()
    } catch {
      // start() throws if the recognizer is already running — treat as no-op.
      this.recognition = null
    }
  }

  stopListening(commit = false): void {
    this.wantListening = false
    this.micActive = false
    this.clearSilenceTimer()
    this.clearRestartTimer()
    this.recognition?.stop()
    this.recognition = null
    this.interim = ''
    this.stopLevelMeter()
    if (commit) {
      // Manual stop: hand over whatever was recognized so far, no waiting
      // for the silence window.
      const utterance = this.finalText.trim()
      this.finalText = ''
      if (utterance && this.onUtterance) this.onUtterance(utterance)
    }
  }

  // ── Live mic level meter ────────────────────────────────────────────────

  private startLevelMeter(stream: MediaStream): void {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      void ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      this.audioCtx = ctx
      this.analyser = analyser

      const data = this.levelData
      const tick = () => {
        if (!this.analyser) return
        this.analyser.getByteTimeDomainData(data)
        // RMS of the waveform, scaled up — speech sits around 0.05–0.3 RMS.
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        this.micLevel = Math.min(1, rms * 4)
        this.levelRafId = requestAnimationFrame(tick)
      }
      this.levelRafId = requestAnimationFrame(tick)
    } catch (e) {
      console.info('[voice] level meter unavailable:', e)
    }
  }

  private stopLevelMeter(): void {
    if (this.levelRafId) {
      cancelAnimationFrame(this.levelRafId)
      this.levelRafId = 0
    }
    this.analyser = null
    this.micLevel = 0
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
    void this.audioCtx?.close().catch(() => {})
    this.audioCtx = null
  }

  private restartSilenceTimer(): void {
    this.clearSilenceTimer()
    this.silenceTimer = setTimeout(() => this.finishUtterance(), SILENCE_MS)
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== undefined) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = undefined
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
  }

  /** Silence window elapsed: hand the accumulated utterance to the app. */
  private finishUtterance(): void {
    const utterance = `${this.finalText} ${this.interim}`.trim()
    this.finalText = ''
    this.stopListening()
    if (utterance && this.onUtterance) this.onUtterance(utterance)
  }

  // ── Speech synthesis (Jev's voice) ──────────────────────────────────────

  toggleTts(): void {
    this.ttsEnabled = !this.ttsEnabled
    localStorage.setItem(TTS_STORAGE_KEY, String(this.ttsEnabled))
    if (!this.ttsEnabled) this.stopSpeaking()
  }

  stopSpeaking(): void {
    if (!this.ttsSupported) return
    const wasSpeaking = this.speaking
    window.speechSynthesis.cancel()
    if (this.speakTimeout !== undefined) {
      clearTimeout(this.speakTimeout)
      this.speakTimeout = undefined
    }
    this.currentUtterance = null
    this.cancelEnvelope()
    this.speaking = false
    this.mouthOpen = 0
    if (wasSpeaking) this.onSpeechEnd?.()
  }

  /**
   * Speak a reply with emotion-modulated pitch/rate and drive the lip-sync
   * envelope while it plays. No-op when TTS is disabled or unsupported.
   */
  speak(text: string, reaction: ReactionResult | null): void {
    if (!this.ttsSupported) return
    if (!this.ttsEnabled) {
      console.info('[voice] speak skipped (TTS toggle is off)')
      return
    }
    if (!text.trim()) return
    this.stopSpeaking()

    const spoken = stripEmoji(text)
    if (!spoken) {
      console.info('[voice] speak skipped (nothing speakable after emoji strip)')
      return
    }

    const utterance = new SpeechSynthesisUtterance(spoken)
    const params = reaction
      ? VOICE_BY_EMOTION[reaction.emotion]
      : VOICE_BY_EMOTION.neutral
    utterance.rate = params.rate
    utterance.pitch = params.pitch
    // High-intensity reactions push the rate a bit further.
    if (reaction && reaction.intensity >= 4) {
      utterance.rate = Math.min(2, utterance.rate + 0.05)
    }
    utterance.lang = localeToBcp47(getLocale())
    const voice = pickVoice(utterance.lang)
    if (voice) utterance.voice = voice

    utterance.onstart = () => {
      console.info('[voice] speaking', { lang: utterance.lang, rate: utterance.rate, pitch: utterance.pitch, voice: utterance.voice?.name })
      this.speaking = true
      this.startEnvelope()
    }
    utterance.onboundary = () => {
      // Word boundary: pulse the mouth open for this word. The pulse is
      // instant; the RAF loop decays it back toward 0 between words.
      this.sawBoundary = true
      this.envelopeTarget = 0.6 + Math.random() * 0.3
      this.mouthOpen = this.envelopeTarget
    }
    utterance.onend = () => {
      console.info('[voice] speech ended')
      this.endSpeech()
    }
    utterance.onerror = (event) => {
      console.info('[voice] speech error:', event.error)
      this.endSpeech()
    }

    // Hold a reference: Chrome drops events for GC'd utterances.
    this.currentUtterance = utterance
    window.speechSynthesis.speak(utterance)

    // Hard cap: Chrome occasionally never fires onend (stuck engine) —
    // force-end past a generous duration estimate so the avatar can't
    // freeze mid-talk with the mouth hanging open.
    const words = text.trim().split(/\s+/).length
    const estimatedMs = (words / (2.6 * utterance.rate)) * 1000 + 2500
    this.speakTimeout = setTimeout(() => {
      console.info('[voice] speak hard-timeout — forcing end')
      window.speechSynthesis.cancel()
      this.endSpeech()
    }, estimatedMs)
  }

  private endSpeech(): void {
    if (this.speakTimeout !== undefined) {
      clearTimeout(this.speakTimeout)
      this.speakTimeout = undefined
    }
    const wasSpeaking = this.speaking
    this.currentUtterance = null
    this.speaking = false
    this.cancelEnvelope()
    this.mouthOpen = 0
    if (wasSpeaking) this.onSpeechEnd?.()
  }

  // ── Lip-sync envelope ───────────────────────────────────────────────────

  private startEnvelope(): void {
    this.sawBoundary = false
    this.envelopeTarget = 0.7
    this.lastEnvelopeTime = performance.now()
    let watchdogCount = 0
    const tick = (now: number) => {
      if (!this.speaking) return
      const dt = Math.min((now - this.lastEnvelopeTime) / 1000, 0.1)
      this.lastEnvelopeTime = now

      // Watchdog: Chrome sometimes never fires onend (utterance GC, engine
      // crash). If synthesis reports idle for ~1s while we think we're
      // speaking, force-end so the avatar doesn't freeze mid-talk.
      if (++watchdogCount % 60 === 0) {
        const synth = window.speechSynthesis
        if (!synth.speaking && !synth.pending) {
          console.info('[voice] watchdog: synthesis idle without onend — forcing end')
          this.endSpeech()
          return
        }
      }

      if (this.sawBoundary) {
        // Word-driven: onboundary pulses mouthOpen up; between words it
        // decays toward 0. The dip below the renderers' ~0.08 threshold is
        // what makes discrete artwork (Cartman) visibly flap open↔closed.
        this.mouthOpen *= MOUTH_DECAY_PER_SEC ** (dt * 60)
      } else {
        // No boundary events (some engines): flap from fully closed to open
        // so discrete renderers switch variants instead of freezing open.
        const phase = (now / 1000) * FLAP_HZ * Math.PI * 2
        this.mouthOpen = Math.abs(Math.sin(phase)) * 0.8
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private cancelEnvelope(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }
}

/** Map the paraglide locale tag to a BCP 47 tag the speech APIs understand. */
function localeToBcp47(locale: string): string {
  return locale === 'de' ? 'de-DE' : 'en-US'
}

/**
 * Strip emojis/emoticons and decoration from text before speaking it —
 * speech engines read emoji names aloud ("smiling face"), which ruins the
 * reply. Also drops standalone kaomoji-style punctuation runs and collapses
 * the whitespace left behind. The transcript keeps the original text.
 */
function stripEmoji(text: string): string {
  return text
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu,
      '',
    )
    .replace(/(?:^|\s)[\^~\-=_;:'".`,]+(?=\s|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Pick the best installed voice for the utterance language. Voice lists load
 * asynchronously on some platforms; getVoices() may be empty until
 * voiceschanged fires, so fall back to whatever is available.
 */
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return null
  const base = lang.split('-')[0]
  return (
    voices.find((v) => v.lang.replace('_', '-') === lang) ??
    voices.find((v) => v.lang.replace('_', '-').startsWith(base)) ??
    null
  )
}

export const voice = new VoiceController()
