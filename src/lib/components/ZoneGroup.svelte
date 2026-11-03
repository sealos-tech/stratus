<script lang="ts">
  // One availability zone as a collapsible group.
  // Collapsed: icon, name, page count, uptime, zone-wide bars. Expanded: one row per page.
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import StatusIcon from './StatusIcon.svelte'
  import UptimeBars from './UptimeBars.svelte'
  import { buildBars } from '$lib/bars'
  import { loc, t } from '$lib/i18n.svelte'
  import { link, monitorHref } from '$lib/router.svelte'
  import { IMPACT_SEVERITY, covers, rollUp, statusSeverity, sumDays, uptime, worst, type Severity } from '$shared/status'
  import type { ApiEvent, ApiOutage, ApiZone } from '$shared/types'
  import { isActiveEvent } from '$lib/events'

  interface Props {
    zone: ApiZone
    days: string[]
    events: ApiEvent[]
    outages: ApiOutage[]
    timeZone: string
    open: boolean
    onToggle: () => void
  }

  let { zone, days, events, outages, timeZone, open, onToggle }: Props = $props()

  const zoneOutages = $derived(outages.filter((o) => o.zone === zone.id))
  const activeEvents = $derived(events.filter((e) => isActiveEvent(e) && covers(e.components, zone.id)))

  function pageSeverity(monitorId: string, status: ApiZone['monitors'][number]['status']): Severity {
    let s = statusSeverity(status)
    for (const e of activeEvents) if (covers(e.components, zone.id, monitorId)) s = worst(s, IMPACT_SEVERITY[e.impact])
    return s
  }

  const severity = $derived(rollUp(zone.monitors.map((m) => pageSeverity(m.id, m.status))))
  const zoneUptime = $derived(uptime(sumDays(zone.monitors.flatMap((m) => m.days))))
  const zoneBars = $derived(
    buildBars({ days, series: zone.monitors, zone: zone.id, events, outages: zoneOutages, timeZone })
  )
  const count = $derived(zone.monitors.length)
</script>

<div class="border-border-soft border-b p-4 last:border-b-0 md:py-3" data-testid="zone" data-zone={zone.id} data-severity={severity}>
  <div class="flex h-7 items-center justify-between gap-2">
    <button type="button" class="flex min-w-0 cursor-pointer items-center gap-2 text-sm" onclick={onToggle} aria-expanded={open} data-testid="zone-toggle">
      {#if !open}<StatusIcon {severity} />{/if}
      <h3 class="truncate font-medium">{loc(zone.name)}</h3>
      <span class="text-subtle hidden truncate font-normal md:inline">{zone.domain}</span>
      <span class="text-muted-foreground flex shrink-0 items-center whitespace-nowrap {open ? 'text-foreground' : ''}">
        <span class="hidden md:inline">{count} {count === 1 ? t('page') : t('pages')}</span>
        <ChevronRight class="ml-0.5 size-4 transition-transform {open ? 'rotate-90' : ''}" />
      </span>
    </button>
    {#if zoneUptime !== null && !open}
      <span class="text-muted-foreground hidden shrink-0 text-sm md:inline" data-testid="zone-uptime">{zoneUptime}% {t('uptime')}</span>
    {/if}
  </div>

  {#if !open}
    <div class="hidden md:block"><UptimeBars bars={zoneBars} /></div>
  {:else}
    <div class="flex flex-col space-y-2 pt-2" data-testid="zone-pages">
      {#each zone.monitors as m (m.id)}
        {@const s = pageSeverity(m.id, m.status)}
        {@const u = uptime(sumDays(m.days))}
        <div data-testid="monitor-row" data-monitor={m.id} data-status={m.status}>
          <div class="flex h-7 items-center justify-between gap-2">
            <a href={monitorHref(zone.id, m.id)} onclick={link} class="flex min-w-0 items-center gap-2 text-sm hover:underline">
              <StatusIcon severity={s} />
              <h4 class="truncate font-medium">{loc(m.name)}</h4>
            </a>
            <span class="text-muted-foreground shrink-0 text-sm">
              {#if m.status === 'down' && m.error}<span class="text-down mr-2 hidden sm:inline">{m.error}</span>{/if}
              {u !== null ? `${u}% ${t('uptime')}` : t('noData')}
            </span>
          </div>
          <UptimeBars
            bars={buildBars({ days, series: [m], zone: zone.id, monitor: m.id, events, outages: zoneOutages, timeZone })}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>
