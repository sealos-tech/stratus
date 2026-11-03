<script lang="ts">
  import Calendar from '@lucide/svelte/icons/calendar'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import StatusBanner from '$lib/components/StatusBanner.svelte'
  import StatusIcon from '$lib/components/StatusIcon.svelte'
  import ZoneGroup from '$lib/components/ZoneGroup.svelte'
  import { Skeleton } from '$lib/components/ui/skeleton/index.js'
  import { isActiveEvent, isUpcoming } from '$lib/events'
  import { fmtDateTime, fmtDuration, fmtMonthShort, loc, t } from '$lib/i18n.svelte'
  import { link, monitorHref } from '$lib/router.svelte'
  import { IMPACT_SEVERITY, rollUp, statusSeverity, worst, type Severity } from '$shared/status'
  import { IMPACT_LABEL, STATUS_LABEL } from '$shared/labels'
  import type { ApiSummary } from '$shared/types'
  import { i18n } from '$lib/i18n.svelte'

  let { data, error, now, onRetry }: { data: ApiSummary | null; error: string | null; now: number; onRetry: () => void } = $props()

  // Zones are collapsed by default; what is expanded is remembered per browser.
  let expanded = $state<Record<string, boolean>>(JSON.parse(localStorage.getItem('expandedZones') ?? '{}'))
  function toggle(id: string) {
    expanded[id] = !expanded[id]
    localStorage.setItem('expandedZones', JSON.stringify(expanded))
  }

  // Phones show the last 30 days, wider screens 90.
  let narrow = $state(window.matchMedia('(max-width: 639px)').matches)
  $effect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => (narrow = mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  // Window paging, like "< Aug 2026 - Nov 2026 >": 30/90-day windows inside the loaded history.
  let page = $state(0)
  const span = $derived(narrow ? 30 : 90)
  const pages = $derived(data ? Math.max(1, Math.ceil(data.days.length / span)) : 1)
  const end = $derived(data ? data.days.length - page * span : 0)
  const shownDays = $derived(data ? data.days.slice(Math.max(0, end - span), end) : [])
  const zones = $derived(
    data
      ? data.zones.map((z) => ({ ...z, monitors: z.monitors.map((m) => ({ ...m, days: m.days.slice(Math.max(0, end - span), end) })) }))
      : []
  )

  const activeEvents = $derived(data ? data.events.filter(isActiveEvent) : [])
  const upcoming = $derived(data ? data.events.filter(isUpcoming) : [])
  const overall = $derived.by((): Severity => {
    if (!data) return 'nodata'
    let s = rollUp(data.zones.flatMap((z) => z.monitors.map((m) => statusSeverity(m.status))))
    for (const e of activeEvents) s = worst(s, IMPACT_SEVERITY[e.impact])
    return s
  })
  const title = $derived(
    overall === 'up' ? t('operational') : overall === 'degraded' ? t('degraded') : overall === 'partial' ? t('partialOutage') : overall === 'major' ? t('majorOutage') : overall === 'maintenance' ? t('maintenance') : t('nodata')
  )
  const nameOf = (zone: string, monitor: string) => {
    const z = data?.zones.find((x) => x.id === zone)
    const m = z?.monitors.find((x) => x.id === monitor)
    return `${loc(z?.name) || zone} · ${loc(m?.name) || monitor}`
  }
</script>

{#if error && !data}
  <div class="status-card"><div class="status-card-body p-8 text-center text-sm">
    <p class="text-muted-foreground">{t('loadFailed')}: {error}</p>
    <button class="mt-2 font-medium underline" onclick={onRetry}>{t('retry')}</button>
  </div></div>
{:else if !data}
  <Skeleton class="h-[110px] w-full rounded-lg" />
  <Skeleton class="mt-6 h-[420px] w-full rounded-lg" />
{:else}
  <StatusBanner severity={overall} {title}>
    {#if activeEvents.length === 0 && data.ongoingOutages.length === 0}
      <p>{overall === 'nodata' ? t('nodataBody') : t('operationalBody')}</p>
    {:else}
      <div class="flex flex-col gap-3" data-testid="active-issues">
        {#each activeEvents as e (e.id)}
          <a href="/incidents/{e.id}" onclick={link} class="group flex items-start gap-2">
            <StatusIcon severity={IMPACT_SEVERITY[e.impact]} class="mt-0.5" />
            <span class="min-w-0">
              <span class="font-medium group-hover:underline">{e.title}</span>
              <span class="text-muted-foreground"> · {STATUS_LABEL[e.status][i18n.lang]} · {IMPACT_LABEL[e.impact][i18n.lang]}</span>
              {#if e.updates[0]}<span class="text-muted-foreground mt-0.5 line-clamp-2 block">{e.updates[0].body}</span>{/if}
            </span>
          </a>
        {/each}
        {#if data.ongoingOutages.length}
          <p class="text-muted-foreground">{t('issuesBody')}</p>
          {#each data.ongoingOutages as o (o.id)}
            <a href={monitorHref(o.zone, o.monitor)} onclick={link} class="group flex items-start gap-2" data-testid="ongoing-outage">
              <StatusIcon severity="partial" class="mt-0.5" />
              <span class="min-w-0">
                <span class="font-medium group-hover:underline">{nameOf(o.zone, o.monitor)}</span>
                <span class="text-muted-foreground"> · {t('down')} {fmtDuration(now - o.start)}</span>
                <span class="text-subtle block truncate">{o.error}</span>
              </span>
            </a>
          {/each}
        {/if}
      </div>
    {/if}
  </StatusBanner>

  {#each upcoming as e (e.id)}
    <a href="/incidents/{e.id}" onclick={link} class="status-card mt-4 block" style="--frame: var(--maintenance)" data-testid="upcoming-maintenance">
      <div class="status-card-body flex items-start gap-2 p-4 text-sm">
        <StatusIcon severity="maintenance" class="mt-0.5" />
        <div class="min-w-0">
          <p class="font-medium">{t('upcomingMaintenance')}: {e.title}</p>
          <p class="text-muted-foreground mt-0.5">{fmtDateTime(e.startsAt, data.site.timezone)}{e.endsAt ? ` → ${fmtDateTime(e.endsAt, data.site.timezone)}` : ''}</p>
        </div>
      </div>
    </a>
  {/each}

  <section class="status-card mt-6" data-testid="system-status">
    <div class="status-card-body">
      <div class="border-border-soft flex items-center gap-4 border-b px-4 py-3.5">
        <h2 class="text-base font-medium">{t('systemStatus')}</h2>
        <div class="text-muted-foreground flex items-center gap-1 text-sm">
          <button type="button" class="disabled:opacity-40" disabled={page >= pages - 1} onclick={() => page++} aria-label="Earlier"><ChevronLeft class="size-4" /></button>
          <span>{fmtMonthShort(shownDays[0])} - {fmtMonthShort(shownDays[shownDays.length - 1])}</span>
          <button type="button" class="disabled:opacity-40" disabled={page === 0} onclick={() => page--} aria-label="Later"><ChevronRight class="size-4" /></button>
        </div>
      </div>
      {#each zones as zone (zone.id)}
        <ZoneGroup
          {zone}
          days={shownDays}
          events={data.events}
          outages={data.ongoingOutages}
          timeZone={data.site.timezone}
          open={!!expanded[zone.id]}
          onToggle={() => toggle(zone.id)}
        />
      {/each}
    </div>
  </section>

  <div class="mt-6 flex justify-center">
    <a href="/history" onclick={link} class="hover:bg-secondary flex h-9 items-center gap-1 rounded-md border border-[#cacace] px-2.5 text-sm font-medium dark:border-input" data-testid="view-history">
      <Calendar class="size-4" />{t('viewHistory')}
    </a>
  </div>
{/if}
