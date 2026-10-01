// Global debug log for HTTP traffic. A Svelte 5 universal state class so the
// same instance is shared between all importers (client only in practice).
//
// Entries record a request/response pair for the debug console in App.svelte.
// Responses are stored as raw text (not parsed objects) so the console shows
// exactly what the server sent, including error bodies.

export interface DebugEntry {
  id: number
  /** ISO timestamp of when the request was sent */
  startedAt: string
  /** ms until response headers + body were consumed; undefined while pending */
  durationMs?: number
  method: string
  url: string
  /** redacted request headers */
  requestHeaders: Record<string, string>
  /** request body as pretty JSON (or raw string) */
  requestBody: string
  /** HTTP status code; undefined while pending or on network failure */
  status?: number
  statusText?: string
  /** response headers (subset) */
  responseHeaders?: Record<string, string>
  /** response body as pretty JSON (or raw string); undefined while pending */
  responseBody?: string
  /** network/parse failure message; undefined on success */
  error?: string
}

let nextId = 1

class DebugLog {
  entries = $state<DebugEntry[]>([])
  /** cap so a long typing session can't grow the log unbounded */
  private static readonly MAX_ENTRIES = 100

  add(entry: Omit<DebugEntry, 'id'>): DebugEntry {
    const full: DebugEntry = { id: nextId++, ...entry }
    this.entries = [full, ...this.entries].slice(0, DebugLog.MAX_ENTRIES)
    return full
  }

  update(id: number, patch: Partial<DebugEntry>) {
    this.entries = this.entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
  }

  clear() {
    this.entries = []
  }
}

export const debugLog = new DebugLog()

/** Pretty-print a JSON string if parseable, otherwise return it as-is. */
function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

/** Redact the Authorization header so keys never land in the debug console. */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = /authorization|token|key/i.test(k) ? '••••••••' : v
  }
  return out
}

export interface LoggedFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/**
 * fetch wrapper that records the request/response pair in the debug log.
 * Mirrors the fetch contract: resolves with the Response, rejects on network
 * errors (after logging the failure).
 */
export async function loggedFetch(url: string, init: LoggedFetchInit = {}): Promise<Response> {
  const method = init.method ?? 'GET'
  const startedAt = new Date().toISOString()
  const started = performance.now()

  const entry = debugLog.add({
    startedAt,
    method,
    url,
    requestHeaders: redactHeaders(init.headers ?? {}),
    requestBody: init.body ? pretty(init.body) : '',
  })

  try {
    const response = await fetch(url, {
      method,
      headers: init.headers,
      body: init.body,
    })

    // Consume the body so we can show it; clone first so the caller can still
    // read the original response themselves.
    const clone = response.clone()
    const text = await clone.text()

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v
    })

    debugLog.update(entry.id, {
      durationMs: Math.round(performance.now() - started),
      status: response.status,
      statusText: response.statusText,
      responseHeaders,
      responseBody: pretty(text),
    })

    return response
  } catch (e) {
    debugLog.update(entry.id, {
      durationMs: Math.round(performance.now() - started),
      error: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}