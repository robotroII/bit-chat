<script lang="ts">
  import { m } from './lib/paraglide/messages'
  import { getLocale, setLocale } from './lib/paraglide/runtime'

  let locale = $state(getLocale())

  function toggleLocale() {
    const next = locale === 'en' ? 'de' : 'en'
    setLocale(next)
    locale = next
  }
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-950 text-gray-100">
  <h1 class="text-4xl font-bold tracking-tight">{m.hello({ name: 'world' })}</h1>
  <p class="text-lg text-gray-400">{m.welcome()}</p>
  <button
    class="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium transition hover:bg-indigo-500 active:scale-95"
    onclick={toggleLocale}
  >
    {m.switch_locale()}
  </button>
  <p class="text-sm text-gray-500">locale: {locale}</p>
</main>