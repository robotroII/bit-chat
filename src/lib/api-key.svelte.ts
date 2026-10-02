// API key settings: a runtime override for the OpenRouter key that wins over
// the build-time `VITE_OPENROUTER_KEY` from .env. Persisted in localStorage so
// the override survives reloads. Both LLM modules (chat.ts, emotion.ts) read
// the key through `effectiveApiKey()` instead of touching import.meta.env
// directly, so a user-entered key takes effect without a rebuild.

const STORAGE_KEY = 'jev:openrouter-key'

class ApiKeySettings {
  /** User-entered override; empty string = use the .env key. */
  override = $state(localStorage.getItem(STORAGE_KEY) ?? '')

  /** The key actually used for requests: override first, .env fallback. */
  get effective(): string {
    return this.override.trim() || import.meta.env.VITE_OPENROUTER_KEY || ''
  }

  /** True when the effective key comes from the user's input, not .env. */
  get isOverridden(): boolean {
    return this.override.trim().length > 0
  }

  set(value: string): void {
    this.override = value
    const trimmed = value.trim()
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }
}

export const apiKeySettings = new ApiKeySettings()

/** The OpenRouter key for LLM requests: runtime override > .env. */
export function effectiveApiKey(): string {
  return apiKeySettings.effective
}