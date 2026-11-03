<script lang="ts">
  // Globe button with a menu of languages, each listed under its own name.
  import Languages from '@lucide/svelte/icons/languages'
  import Check from '@lucide/svelte/icons/check'
  import * as Dropdown from '$lib/components/ui/dropdown-menu/index.js'
  import { i18n, setLang, t, type Lang } from '$lib/i18n.svelte'

  const LANGUAGES: { id: Lang; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'zh', label: '简体中文' },
  ]
</script>

<Dropdown.Root>
  <Dropdown.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        class="text-muted-foreground hover:text-foreground hover:bg-secondary grid size-[34px] place-items-center rounded-md transition"
        aria-label={t('languageMenu')}
        title={t('languageMenu')}
        data-testid="lang-menu"
      >
        <Languages class="size-4" />
      </button>
    {/snippet}
  </Dropdown.Trigger>
  <Dropdown.Content align="end" class="min-w-36">
    {#each LANGUAGES as l (l.id)}
      <Dropdown.Item class="cursor-pointer justify-between text-sm" onclick={() => setLang(l.id)} data-testid="lang-{l.id}">
        <span lang={l.id === 'en' ? 'en' : 'zh-CN'}>{l.label}</span>
        {#if i18n.lang === l.id}<Check class="size-4" />{/if}
      </Dropdown.Item>
    {/each}
  </Dropdown.Content>
</Dropdown.Root>
