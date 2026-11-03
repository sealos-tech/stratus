<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import { subscribe } from '$lib/api'
  import { i18n, loc, t } from '$lib/i18n.svelte'
  import type { ApiZone, SubscriberKind } from '$shared/types'

  let { open = $bindable(), zones, emailEnabled }: { open: boolean; zones: ApiZone[]; emailEnabled: boolean } = $props()

  let kind = $state<SubscriberKind>('webhook')
  let target = $state('')
  let selected = $state<string[]>([])
  let auto = $state(true)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let done = $state<string | null>(null)

  $effect(() => {
    if (open) {
      error = null
      done = null
      kind = emailEnabled ? 'email' : 'webhook'
    }
  })

  function toggleZone(id: string) {
    selected = selected.includes(id) ? selected.filter((z) => z !== id) : [...selected, id]
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    busy = true
    error = null
    try {
      const res = await subscribe({ kind, target, zones: selected.length ? selected : null, auto, lang: i18n.lang })
      done = res.verified ? t('webhookOk') : t('confirmSent')
      target = ''
    } catch (err) {
      error = (err as Error).message
    } finally {
      busy = false
    }
  }

  const tab = (active: boolean) =>
    `flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="gap-0 rounded-lg p-0 sm:max-w-[440px]" data-testid="subscribe-dialog">
    <div class="border-b px-5 pt-5 pb-4">
      <Dialog.Title class="text-base font-medium">{t('subscribeTitle')}</Dialog.Title>
      <Dialog.Description class="text-muted-foreground mt-1 text-sm">{t('subscribeDesc')}</Dialog.Description>
    </div>
    {#if done}
      <div class="flex flex-col items-start gap-4 p-5" data-testid="subscribe-done">
        <p class="text-sm">{done}</p>
        <button type="button" class="bg-primary text-primary-foreground h-[34px] rounded-md px-3 text-sm font-medium" onclick={() => (open = false)}>OK</button>
      </div>
    {:else}
      <form class="flex flex-col gap-4 p-5" onsubmit={submit}>
        <div class="bg-secondary flex gap-1 rounded-md p-1">
          <button type="button" class={tab(kind === 'email')} onclick={() => (kind = 'email')}>{t('email')}</button>
          <button type="button" class={tab(kind === 'webhook')} onclick={() => (kind = 'webhook')} data-testid="subscribe-webhook-tab">{t('webhook')}</button>
        </div>
        {#if kind === 'email' && !emailEnabled}
          <p class="text-muted-foreground text-sm">{t('emailDisabled')}</p>
        {:else}
          <div class="flex flex-col gap-1.5">
            <input
              class="border-input focus:border-foreground/40 h-9 rounded-md border bg-transparent px-3 text-sm outline-none"
              type={kind === 'email' ? 'email' : 'url'}
              required
              placeholder={kind === 'email' ? t('emailPlaceholder') : t('webhookPlaceholder')}
              bind:value={target}
              data-testid="subscribe-target"
            />
            {#if kind === 'webhook'}<p class="text-subtle text-xs leading-[18px]">{t('webhookHint')}</p>{/if}
          </div>
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm font-medium">{t('zonesToFollow')}</legend>
            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                class="rounded-full border px-2.5 py-1 text-xs font-medium transition {selected.length === 0 ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-secondary'}"
                onclick={() => (selected = [])}>{t('allZones')}</button
              >
              {#each zones as z (z.id)}
                <button
                  type="button"
                  class="rounded-full border px-2.5 py-1 text-xs font-medium transition {selected.includes(z.id) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-secondary'}"
                  onclick={() => toggleZone(z.id)}>{loc(z.name)}</button
                >
              {/each}
            </div>
          </fieldset>
          <label class="text-muted-foreground flex items-start gap-2 text-sm">
            <input type="checkbox" class="accent-foreground mt-0.5" bind:checked={auto} />
            {t('includeAuto')}
          </label>
          {#if error}<p class="text-down text-sm" data-testid="subscribe-error">{error}</p>{/if}
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="hover:bg-secondary h-[34px] rounded-md border border-[#cacace] px-3 text-sm font-medium dark:border-input" onclick={() => (open = false)}>{t('cancel')}</button>
            <button type="submit" disabled={busy} class="bg-primary text-primary-foreground h-[34px] rounded-md px-3 text-sm font-medium disabled:opacity-60" data-testid="subscribe-submit">
              {busy ? '…' : t('submit')}
            </button>
          </div>
        {/if}
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
