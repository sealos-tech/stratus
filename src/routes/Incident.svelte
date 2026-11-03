<script lang="ts">
  // Incident / maintenance page.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import { Skeleton } from '$lib/components/ui/skeleton/index.js'
  import { fetchEvent } from '$lib/api'
  import { fmtDateTime, fmtTime, i18n, loc, relative, t } from '$lib/i18n.svelte'
  import { link } from '$lib/router.svelte'
  import { IMPACT_LABEL, STATUS_LABEL } from '$shared/labels'
  import type { ApiEventDetail, EventStatus, Impact } from '$shared/types'

  let { id, now }: { id: number; now: number } = $props()
  let data = $state<ApiEventDetail | null>(null)
  let error = $state<string | null>(null)

  $effect(() => {
    fetchEvent(id)
      .then((d) => (data = d))
      .catch((e: Error) => (error = e.message))
  })

  const done = (s: EventStatus) => s === 'resolved' || s === 'completed'
  const FRAME: Record<Impact, string> = { degraded: 'var(--degraded)', partial: 'var(--partial)', major: 'var(--down)', maintenance: 'var(--maintenance)' }
  const SOFT: Record<Impact, string> = { degraded: 'var(--degraded-soft)', partial: 'var(--partial-soft)', major: 'var(--down-soft)', maintenance: 'var(--maintenance-soft)' }
  const DOT: Record<EventStatus, string> = {
    investigating: 'var(--down)',
    identified: 'var(--partial)',
    monitoring: 'var(--degraded)',
    resolved: 'var(--up)',
    scheduled: 'var(--maintenance)',
    in_progress: 'var(--maintenance)',
    completed: 'var(--up)',
  }

  const groups = $derived.by(() => {
    if (!data) return []
    const e = data.event
    if (e.components.length === 0) return data.zones.map((z) => ({ name: loc(z.name), pages: [] as string[] }))
    const out: { name: string; pages: string[] }[] = []
    for (const c of e.components) {
      const z = data.zones.find((x) => x.id === c.zone)
      let g = out.find((x) => x.name === loc(z?.name))
      if (!g) out.push((g = { name: loc(z?.name) || c.zone, pages: [] }))
      if (c.monitor) g.pages.push(loc(z?.monitors.find((m) => m.id === c.monitor)?.name) || c.monitor)
    }
    return out
  })

  // Timeline bar for the affected window: before / during / after.
  const timeline = $derived.by(() => {
    if (!data) return null
    const e = data.event
    const end = e.endsAt ?? now
    const pad = Math.max(600, (end - e.startsAt) * 0.1)
    const from = e.startsAt - pad
    const to = (e.endsAt ?? now) + (e.endsAt ? pad : 0)
    const pct = (ts: number) => ((ts - from) / (to - from)) * 100
    return { from: e.startsAt, to: e.endsAt, start: pct(e.startsAt), end: pct(end), ongoing: !e.endsAt }
  })
</script>

{#if error}
  <p class="text-muted-foreground py-10 text-sm">{t('loadFailed')}: {error}</p>
{:else if !data}
  <Skeleton class="h-40 w-full rounded-lg" />
{:else}
  {@const e = data.event}
  {@const latest = e.updates[0]}
  {@const frame = done(e.status) ? 'var(--up)' : FRAME[e.impact]}
  {@const soft = done(e.status) ? 'var(--up-soft)' : SOFT[e.impact]}
  <div class="status-card" style="--frame: {frame}" data-testid="incident" data-status={e.status}>
    <div class="status-card-body">
      <div class="flex items-start gap-2 rounded-t-[7px] px-4 py-3.5" style="background: {soft}">
        <a href="/" onclick={link} class="text-muted-foreground hover:text-foreground mt-1" aria-label={t('backToStatus')}><ChevronLeft class="size-4" /></a>
        <h1 class="text-base font-medium">{e.title}</h1>
      </div>
      <div class="text-muted-foreground border-b px-4 py-3 text-sm">
        {STATUS_LABEL[e.status][i18n.lang]} · {IMPACT_LABEL[e.impact][i18n.lang]}
      </div>
      {#if latest}
        <div class="flex flex-col gap-3 p-4 text-sm">
          <p class="whitespace-pre-line">{latest.body}</p>
          <p class="text-muted-foreground">
            {fmtDateTime(latest.createdAt, data.timezone)} ({relative(latest.createdAt, now)})
            {#if e.updates.length > 1}· <a href="#updates" class="hover:text-foreground">{t('viewAllUpdates')}</a>{/if}
          </p>
        </div>
      {/if}
    </div>
  </div>

  <section class="status-card mt-6">
    <div class="status-card-body">
      <h2 class="border-border-soft border-b px-4 py-3.5 text-base font-medium">{t('affected')}</h2>
      {#if timeline}
        <div class="text-subtle border-border-soft flex justify-between border-b px-4 py-2.5 text-xs">
          <span>{fmtDateTime(timeline.from, data.timezone)}</span>
          <span>{timeline.to ? fmtTime(timeline.to, data.timezone) : t('ongoing')}</span>
        </div>
      {/if}
      {#each groups as g (g.name)}
        <div class="border-border-soft border-b px-4 py-3 last:border-b-0">
          <p class="text-sm"><span class="font-medium">{g.name}</span> <span class="text-muted-foreground">{g.pages.length ? g.pages.join(' · ') : t('allPages')}</span></p>
          {#if timeline}
            <div class="relative mt-2 h-2.5 overflow-hidden rounded-sm">
              <div class="absolute inset-y-0 left-0 rounded-sm bg-up" style="width: calc({timeline.start}% - 3px)"></div>
              <div class="absolute inset-y-0 rounded-sm" style="left: {timeline.start}%; width: {timeline.end - timeline.start}%; background: {FRAME[e.impact]}"></div>
              {#if !timeline.ongoing}<div class="absolute inset-y-0 right-0 rounded-sm bg-up" style="left: calc({timeline.end}% + 3px)"></div>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="status-card mt-6" id="updates">
    <div class="status-card-body">
      <h2 class="border-border-soft border-b px-4 py-3.5 text-base font-medium">{t('updates')}</h2>
      <ol class="px-4 py-4">
        {#each e.updates as u, i (u.id)}
          <li class="relative pb-6 pl-4 last:pb-0" data-testid="incident-update">
            {#if i < e.updates.length - 1}<span class="bg-border absolute top-4 bottom-0 left-[2.5px] w-px"></span>{/if}
            <span class="absolute top-[7px] left-0 size-1.5 rounded-full" style="background: {DOT[u.status]}"></span>
            <p class="text-sm font-medium">{STATUS_LABEL[u.status][i18n.lang]}</p>
            <p class="mt-2 text-sm whitespace-pre-line">{u.body}</p>
            <p class="text-muted-foreground mt-2 text-sm">
              {fmtDateTime(u.createdAt, data.timezone)}
              {#if i > 0}<span class="text-subtle">({relative(u.createdAt, e.updates[0].createdAt).replace(/ ago$|前$/, i18n.lang === 'en' ? ' earlier' : '前')})</span>{/if}
            </p>
          </li>
        {/each}
      </ol>
    </div>
  </section>
{/if}
