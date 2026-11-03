<script lang="ts">
  // Month-grouped incident history.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import StatusIcon from '$lib/components/StatusIcon.svelte'
  import * as Dropdown from '$lib/components/ui/dropdown-menu/index.js'
  import { Skeleton } from '$lib/components/ui/skeleton/index.js'
  import { fetchHistory } from '$lib/api'
  import { fmtDuration, fmtMonth, fmtTime, i18n, loc, t } from '$lib/i18n.svelte'
  import { link, monitorHref } from '$lib/router.svelte'
  import { localParts } from '$shared/time'
  import { covers } from '$shared/status'
  import type { ApiHistory } from '$shared/types'

  let { now }: { now: number } = $props()
  const SPAN = 90 * 86400
  let offset = $state(0)
  let zoneFilter = $state<string | null>(null)
  let data = $state<ApiHistory | null>(null)
  let error = $state<string | null>(null)

  $effect(() => {
    const to = now - offset * SPAN + 1
    data = null
    fetchHistory(to - SPAN, to)
      .then((d) => (data = d))
      .catch((e: Error) => (error = e.message))
  })

  const BAR: Record<string, string> = { degraded: 'var(--degraded)', partial: 'var(--partial)', major: 'var(--down)', maintenance: 'var(--maintenance)' }

  interface Item {
    key: string
    ts: number
    title: string
    summary: string
    color: string
    href: string
  }

  const months = $derived.by(() => {
    if (!data) return []
    const tz = data.timezone
    const items: Item[] = []
    for (const e of data.events) {
      if (zoneFilter && !covers(e.components, zoneFilter)) continue
      items.push({ key: `e${e.id}`, ts: e.startsAt, title: e.title, summary: e.updates[0]?.body ?? '', color: BAR[e.impact], href: `/incidents/${e.id}` })
    }
    for (const o of data.outages) {
      if (zoneFilter && o.zone !== zoneFilter) continue
      const z = data.zones.find((x) => x.id === o.zone)
      const m = z?.monitors.find((x) => x.id === o.monitor)
      const name = `${loc(z?.name) || o.zone} · ${loc(m?.name) || o.monitor}`
      items.push({
        key: `o${o.id}`,
        ts: o.start,
        title: i18n.lang === 'en' ? `${name} unavailable` : `${name} 无法访问`,
        summary: `${t('detected')} · ${o.end ? `${t('lasted')} ${fmtDuration(o.end - o.start)}` : t('ongoing')} · ${o.error}`,
        color: 'var(--down)',
        href: monitorHref(o.zone, o.monitor),
      })
    }
    items.sort((a, b) => b.ts - a.ts)

    // Month buckets from the newest month of the window back three months.
    const buckets: { label: string; key: string; days: { day: number; weekday: string; items: Item[] }[] }[] = []
    const cursor = new Date((data.to - 1) * 1000)
    for (let i = 0; i < 3; i++) {
      const monthTs = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 15) / 1000
      buckets.push({ label: fmtMonth(monthTs, tz), key: localParts(monthTs, tz).day.slice(0, 7), days: [] })
    }
    for (const item of items) {
      const { day } = localParts(item.ts, tz)
      const bucket = buckets.find((b) => b.key === day.slice(0, 7))
      if (!bucket) continue
      const d = Number(day.slice(8))
      let entry = bucket.days.find((x) => x.day === d)
      if (!entry) {
        const weekday = new Intl.DateTimeFormat(i18n.lang === 'en' ? 'en-US' : 'zh-CN', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${day}T12:00:00Z`))
        entry = { day: d, weekday, items: [] }
        bucket.days.push(entry)
      }
      entry.items.push(item)
    }
    return buckets
  })

  const rangeLabel = $derived(data ? `${fmtMonth(data.from + 86400, data.timezone)} - ${fmtMonth(data.to - 1, data.timezone)}` : '')
</script>

<div class="text-muted-foreground mt-6 text-sm"><a href="/" onclick={link} class="hover:text-foreground">{t('home')}</a> / <span class="text-foreground">{t('history')}</span></div>

<div class="mt-6 flex items-center justify-between gap-3 border-b pb-3">
  <div class="flex items-center gap-4">
    <h1 class="text-base font-semibold">{t('history')}</h1>
    <div class="text-muted-foreground flex items-center gap-1 text-sm">
      <button type="button" onclick={() => offset++} aria-label="Earlier"><ChevronLeft class="size-4" /></button>
      <span class="hidden sm:inline">{rangeLabel}</span>
      <button type="button" class="disabled:opacity-40" disabled={offset === 0} onclick={() => offset--} aria-label="Later"><ChevronRight class="size-4" /></button>
    </div>
  </div>
  {#if data}
    <Dropdown.Root>
      <Dropdown.Trigger>
        {#snippet child({ props })}
          <button {...props} class="hover:bg-secondary flex h-[33px] items-center gap-1 rounded-md border px-2.5 text-sm">
            {zoneFilter ? loc(data?.zones.find((z) => z.id === zoneFilter)?.name) : t('allZones')}<ChevronDown class="size-4" />
          </button>
        {/snippet}
      </Dropdown.Trigger>
      <Dropdown.Content align="end">
        <Dropdown.Item onclick={() => (zoneFilter = null)}>{t('allZones')}</Dropdown.Item>
        {#each data.zones as z (z.id)}<Dropdown.Item onclick={() => (zoneFilter = z.id)}>{loc(z.name)}</Dropdown.Item>{/each}
      </Dropdown.Content>
    </Dropdown.Root>
  {/if}
</div>

{#if error}
  <p class="text-muted-foreground py-8 text-sm">{t('loadFailed')}: {error}</p>
{:else if !data}
  <Skeleton class="mt-6 h-64 w-full" />
{:else}
  {#each months as month (month.key)}
    <section class="border-b py-6" data-testid="history-month">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">{month.label}</h2>
        {#if month.days.length === 0}
          <span class="text-muted-foreground flex items-center gap-2 text-sm"><StatusIcon severity="up" />{t('noIncidentsReported')}</span>
        {/if}
      </div>
      {#each month.days as d, di (d.day)}
        <div class="flex gap-4 pt-6 {di > 0 ? 'mt-6 border-t pt-6' : ''}">
          <div class="w-14 shrink-0 text-sm"><span class="font-semibold">{d.day}</span> <span class="text-subtle text-xs">{d.weekday}</span></div>
          <div class="flex min-w-0 flex-1 flex-col gap-5">
            {#each d.items as item (item.key)}
              <a href={item.href} onclick={link} class="group flex gap-3" data-testid="history-item">
                <span class="w-[3px] shrink-0 rounded-full" style="background: {item.color}"></span>
                <span class="min-w-0 flex-1 text-sm">
                  <span class="font-medium group-hover:underline">{item.title}</span>
                  <span class="text-muted-foreground mt-1 line-clamp-2 block">{item.summary}</span>
                </span>
                <span class="text-subtle shrink-0 text-xs">{fmtTime(item.ts, data.timezone)}</span>
              </a>
            {/each}
          </div>
        </div>
      {/each}
    </section>
  {/each}
{/if}
