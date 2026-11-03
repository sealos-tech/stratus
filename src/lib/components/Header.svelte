<script lang="ts">
  // Logo left; language, theme and "Subscribe to updates" right.
  import Sun from '@lucide/svelte/icons/sun'
  import Moon from '@lucide/svelte/icons/moon'
  import { i18n, loc, setLang, t } from '$lib/i18n.svelte'
  import { link } from '$lib/router.svelte'
  import { theme, toggleTheme } from '$lib/theme.svelte'
  import type { SiteConfig } from '$shared/types'

  let { site, onSubscribe, divider = false }: { site: SiteConfig | null; onSubscribe?: () => void; divider?: boolean } = $props()
</script>

<header class="flex items-center justify-between gap-3 pt-8 pb-6 {divider ? 'border-b' : ''}">
  <a href="/" onclick={link} class="flex min-w-0 items-center gap-2.5" aria-label="Home">
    <img src="/logo.svg" alt="" class="size-7 shrink-0" />
    <span class="truncate text-[22px] leading-none font-semibold tracking-[-0.02em]">{site ? loc(site.title) : ''}</span>
  </a>
  <div class="flex shrink-0 items-center gap-1.5">
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground hover:bg-secondary hidden h-[34px] rounded-md px-2.5 text-sm font-medium transition sm:block"
      onclick={() => setLang(i18n.lang === 'en' ? 'zh' : 'en')}
      data-testid="lang-toggle">{t('language')}</button
    >
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground hover:bg-secondary grid size-[34px] place-items-center rounded-md transition"
      onclick={toggleTheme}
      aria-label={theme.mode === 'dark' ? t('light') : t('dark')}
      data-testid="theme-toggle"
    >
      {#if theme.mode === 'dark'}<Sun class="size-4" />{:else}<Moon class="size-4" />{/if}
    </button>
    {#if onSubscribe}
      <button
        type="button"
        class="bg-primary text-primary-foreground border-primary h-[34px] rounded-md border px-2.5 text-sm font-medium transition hover:opacity-90"
        onclick={onSubscribe}
        data-testid="subscribe-button">{t('subscribe')}</button
      >
    {/if}
  </div>
</header>
