<script lang="ts">
  // One page of one zone: current state, 90-day bars, response time trend, outages.
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right'
  import StatusBanner from '$lib/components/StatusBanner.svelte'
  import StatusIcon from '$lib/components/StatusIcon.svelte'
  import UptimeBars from '$lib/components/UptimeBars.svelte'
  import LatencyChart from '$lib/components/LatencyChart.svelte'
  import DayDetail from '$lib/components/DayDetail.svelte'
  import { Skeleton } from '$lib/components/ui/skeleton/index.js'
  import { fetchMonitor } from '$lib/api'
  import { buildBars } from '$lib/bars'
  import { fmtDateTime, fmtDay, fmtDuration, fmtMonthShort, loc, relative, t } from '$lib/i18n.svelte'
  import { link } from '$lib/router.svelte'
  import { formatLatency, statusSeverity, uptime } from '$shared/status'
  import type { ApiMonitorDetail, DayCounts } from '$shared/types'

  let { zone, monitor, now, refresh }: { zone: string; monitor: string; now: number; refresh: number } = $props()
  let data = $state<ApiMonitorDetail | null>(null)
  let error = $state<string | null>(null)
  let detail = $state<{ open: boolean; day: string | null }>({ open: false, day: null })

  $effect(() => {
    void refresh
    fetchMonitor(zone, monitor)
      .then((d) => (data = d))
      .catch((e: Error) => (error = e.message))
  })

  const days = $derived(data?.history.map((h): DayCounts => [h.up, h.degraded, h.down, h.maintenance, h.avg]) ?? [])
  const bars = $derived(
    data
      ? buildBars({ days: data.days, series: [{ id: data.monitor.id, name: data.monitor.name, days }], zone, monitor, events: data.events, outages: data.outages, timeZone: data.timezone })
      : []
  )
  const totals = $derived(
    data?.history.reduce((a, d) => ({ up: a.up + d.up, degraded: a.degraded + d.degraded, down: a.down + d.down, maintenance: a.maintenance + d.maintenance }), { up: 0, degraded: 0, down: 0, maintenance: 0 })
  )
  const withLat = $derived(data?.history.filter((d) => d.avg > 0) ?? [])
  const points = $derived(data ? data.history.map((d, i) => ({ x: i, value: d.avg, label: fmtDay(d.day, false) })) : [])
  const ticks = $derived(
    data && data.history.length > 1 ? [0, Math.floor(data.history.length / 2), data.history.length - 1].map((i) => ({ x: i, label: fmtDay(data!.history[i].day, false) })) : []
  )
  const title = $derived(data ? `${loc(data.zone.name)} · ${loc(data.monitor.name)}` : '')
  const STATUS = { up: 'operationalShort', degraded: 'degradedShort', down: 'downShort', maintenance: 'maintenanceShort', nodata: 'nodataShort' } as const
</script>

<div class="text-muted-foreground mb-4 text-sm"><a href="/" onclick={link} class="hover:text-foreground">{t('home')}</a> / <span>{data ? loc(data.zone.name) : zone}</span> / <span class="text-foreground">{data ? loc(data.monitor.name) : monitor}</span></div>

{#if error}
  <p class="text-muted-foreground py-8 text-sm">{t('loadFailed')}: {error}</p>
{:else if !data}
  <Skeleton class="h-[110px] w-full rounded-lg" />
{:else}
  <StatusBanner severity={statusSeverity(data.monitor.status)} title="{title} · {t(STATUS[data.monitor.status])}">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="text-muted-foreground flex flex-col gap-1">
        <a href={data.monitor.url} target="_blank" rel="noopener noreferrer" class="text-foreground inline-flex items-center gap-1 break-all hover:underline">{data.monitor.url}<ArrowUpRight class="size-3.5 shrink-0" /></a>
        <span>
          {t('lastChecked')}: {data.monitor.lastTs ? `${fmtDateTime(data.monitor.lastTs, data.timezone)} (${relative(data.monitor.lastTs, now)})` : '-'}
          {#if data.monitor.colo} · {t('probedFrom')} {data.monitor.colo}{/if}
          {#if data.monitor.code} · HTTP {data.monitor.code}{/if}
        </span>
        {#if data.monitor.status === 'down' && data.monitor.error}<span class="text-down break-all">{data.monitor.error}</span>{/if}
      </div>
      <div class="text-right">
        <p class="text-muted-foreground">{t('latestResponse')}</p>
        <p class="text-xl font-medium tabular-nums" data-testid="latest-latency">{formatLatency(data.monitor.latency)}</p>
      </div>
    </div>
  </StatusBanner>

  <section class="status-card mt-6">
    <div class="status-card-body">
      <div class="border-border-soft flex items-center justify-between border-b px-4 py-3.5">
        <h2 class="text-base font-medium">{t('systemStatus')} <span class="text-muted-foreground ml-2 text-sm font-normal">{fmtMonthShort(data.days[0])} - {fmtMonthShort(data.days[data.days.length - 1])}</span></h2>
        <span class="text-muted-foreground text-sm" data-testid="range-uptime">{totals && uptime(totals) !== null ? `${uptime(totals)}% ${t('uptime')}` : t('noData')}</span>
      </div>
      <div class="p-4">
        <UptimeBars {bars} onSelect={(day) => (detail = { open: true, day })} />
        <div class="text-subtle mt-2 flex justify-between text-xs"><span>{fmtDay(data.days[0], false)}</span><span>{fmtDay(data.days[data.days.length - 1], false)}</span></div>
      </div>
    </div>
  </section>

  <section class="status-card mt-6">
    <div class="status-card-body">
      <div class="border-border-soft flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3.5">
        <h2 class="text-base font-medium">{t('responseTime')}</h2>
        <span class="text-muted-foreground text-sm tabular-nums">
          {t('minAvgMax')}:
          {formatLatency(withLat.length ? Math.min(...withLat.map((d) => d.min || d.avg)) : 0)} /
          {formatLatency(withLat.length ? withLat.reduce((s, d) => s + d.avg, 0) / withLat.length : 0)} /
          {formatLatency(withLat.length ? Math.max(...withLat.map((d) => d.max || d.avg)) : 0)}
        </span>
      </div>
      <div class="p-4"><LatencyChart {points} {ticks} height={160} /></div>
    </div>
  </section>

  {#if data.outages.length || data.events.length}
    <section class="status-card mt-6">
      <div class="status-card-body">
        <h2 class="border-border-soft border-b px-4 py-3.5 text-base font-medium">{t('history')}</h2>
        {#each data.events as e (e.id)}
          <a href="/incidents/{e.id}" onclick={link} class="border-border-soft hover:bg-secondary/60 flex items-start gap-2 border-b px-4 py-3 text-sm">
            <StatusIcon severity={e.impact === 'maintenance' ? 'maintenance' : e.impact} class="mt-0.5" />
            <span class="min-w-0 flex-1"><span class="font-medium">{e.title}</span><span class="text-muted-foreground block">{fmtDateTime(e.startsAt, data.timezone)}</span></span>
          </a>
        {/each}
        {#each data.outages.slice(0, 30) as o (o.id)}
          <button type="button" class="border-border-soft hover:bg-secondary/60 flex w-full items-start gap-2 border-b px-4 py-3 text-left text-sm last:border-b-0" onclick={() => (detail = { open: true, day: new Intl.DateTimeFormat('en-CA', { timeZone: data!.timezone }).format(new Date(o.start * 1000)) })} data-testid="outage-row">
            <StatusIcon severity="major" class="mt-0.5" />
            <span class="min-w-0 flex-1">
              <span class="font-medium">{fmtDateTime(o.start, data.timezone)} · {o.end ? fmtDuration(o.end - o.start) : t('ongoing')}</span>
              <span class="text-muted-foreground block break-all">{o.error}</span>
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <DayDetail bind:open={detail.open} {zone} {monitor} day={detail.day} {title} timeZone={data.timezone} />
{/if}
