/**
 * Ambient declarations for the parts of the Web Speech API that TypeScript's
 * `lib.dom` does not ship (as of TS 6.0): the main `SpeechRecognition`
 * interface and the `webkitSpeechRecognition` constructor Chrome/Edge/Safari
 * expose. The sub-interfaces (SpeechRecognitionEvent, …Result, …Alternative,
 * …ErrorEvent) ARE in lib.dom, so only the controller interface is declared
 * here. Remove this file once lib.dom catches up.
 */

interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null
  onend: ((this: SpeechRecognition, ev: Event) => any) | null
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null
}

interface Window {
  /** Chrome/Edge/Safari expose the constructor under the webkit prefix. */
  webkitSpeechRecognition?: new () => SpeechRecognition
}
