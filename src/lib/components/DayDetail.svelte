<script lang="ts">
  // Minute-by-minute view of one day: 24 rows x 60 cells, plus the day's response times.
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import { Skeleton } from '$lib/components/ui/skeleton/index.js'
  import LatencyChart from './LatencyChart.svelte'
  import { fetchMonitorDay } from '$lib/api'
  import { fmtDay, fmtDuration, fmtTime, t } from '$lib/i18n.svelte'
  import { formatLatency, uptime } from '$shared/status'
  import type { ApiMonitorDay } from '$shared/types'

  let { open = $bindable(), zone, monitor, day, title, timeZone }: { open: boolean; zone: string; monitor: string; day: string | null; title: string; timeZone: string } = $props()

  let data = $state<ApiMonitorDay | null>(null)
  let error = $state<string | null>(null)
  let hover = $state<number | null>(null)

  $effect(() => {
    if (!open || !day) return
    const requested = day
    data = null
    error = null
    fetchMonitorDay(zone, monitor, requested)
      .then((d) => requested === day && (data = d))
      .catch((e: Error) => (error = e.message))
  })

  const COLOR: Record<string, string> = { u: 'var(--up)', d: 'var(--degraded)', x: 'var(--down)', m: 'var(--maintenance)', '.': 'var(--nodata)' }
  const counts = $derived.by(() => {
    const c = { up: 0, degraded: 0, down: 0, maintenance: 0 }
    for (const ch of data?.minutes ?? '') {
      if (ch === 'u') c.up++
      else if (ch === 'd') c.degraded++
      else if (ch === 'x') c.down++
      else if (ch === 'm') c.maintenance++
    }
    return c
  })
  // Failed minutes record the timeout, not a response time: leave them out of the chart and average.
  const answered = $derived(data ? data.latencies.map((v, i) => (data!.minutes[i] === 'x' ? 0 : v)) : [])
  const lat = $derived(answered.filter((v) => v > 0))
  const points = $derived(data ? answered.map((v, i) => ({ x: i, value: v, label: fmtTime(data!.dayStart + i * 60, timeZone) })) : [])
  const ticks = [0, 360, 720, 1080, 1439].map((x) => ({ x, label: x === 1439 ? '24:00' : `${String(x / 60).padStart(2, '0')}:00` }))
  const STATUS = { u: 'operationalShort', d: 'degradedShort', x: 'downShort', m: 'maintenanceShort', '.': 'nodataShort' } as const
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] gap-0 overflow-y-auto rounded-lg p-0 sm:max-w-[680px]" data-testid="day-detail">
    <div class="border-b px-5 pt-5 pb-4">
      <Dialog.Title class="text-base font-medium">{day ? fmtDay(day) : ''}</Dialog.Title>
      <Dialog.Description class="text-muted-foreground mt-1 text-sm">{title}</Dialog.Description>
    </div>
    <div class="flex flex-col gap-6 p-5">
      {#if error}
        <p class="text-muted-foreground text-sm">{t('loadFailed')}: {error}</p>
      {:else if !data}
        <Skeleton class="h-56 w-full" />
      {:else}
        <div class="grid grid-cols-3 gap-3 text-sm">
          <div><p class="text-muted-foreground">{t('uptime')}</p><p class="mt-0.5 text-lg font-medium" data-testid="day-uptime">{uptime(counts) ?? '-'}%</p></div>
          <div><p class="text-muted-foreground">{t('downShort')}</p><p class="mt-0.5 text-lg font-medium">{counts.down ? fmtDuration(counts.down * 60) : '0'}</p></div>
          <div><p class="text-muted-foreground">{t('avgResponse')}</p><p class="mt-0.5 text-lg font-medium">{formatLatency(lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0)}</p></div>
        </div>
        <div>
          <div class="mb-2 flex items-center justify-between text-sm">
            <p class="font-medium">{t('perMinute')}</p>
            <p class="text-subtle h-5 text-xs">
              {#if hover !== null}{fmtTime(data.dayStart + hover * 60, timeZone)} · {t(STATUS[data.minutes[hover] as keyof typeof STATUS])}{#if data.latencies[hover]} · {formatLatency(data.latencies[hover])}{/if}{/if}
            </p>
          </div>
          <div class="flex flex-col gap-[3px]" role="presentation" onmouseleave={() => (hover = null)} data-testid="minute-grid">
            {#each Array(24) as _, h (h)}
              <div class="flex items-center gap-2">
                <span class="text-subtle w-7 shrink-0 text-right text-[10px] tabular-nums">{String(h).padStart(2, '0')}</span>
                <div class="grid flex-1 grid-cols-[repeat(60,minmax(0,1fr))] gap-px">
                  {#each Array(60) as _, m (m)}
                    {@const i = h * 60 + m}
                    <span
                      class="h-2.5 rounded-[1px] {hover === i ? 'outline outline-1 outline-foreground' : ''}"
                      style="background: {COLOR[data.minutes[i]] ?? COLOR['.']}"
                      onmouseenter={() => (hover = i)}
                      role="presentation"
                    ></span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
        <div>
          <p class="mb-2 text-sm font-medium">{t('responseTime')}</p>
          <LatencyChart {points} {ticks} height={150} />
        </div>
        {#if data.outages.length}
          <div class="flex flex-col gap-2 text-sm">
            {#each data.outages as o (o.id)}
              <div class="bg-down-soft rounded-md px-3 py-2">
                <p class="font-medium">{fmtTime(o.start, timeZone)} – {o.end ? fmtTime(o.end, timeZone) : t('ongoing')} · {fmtDuration((o.end ?? Date.now() / 1000) - o.start)}</p>
                <p class="text-muted-foreground mt-0.5 break-all">{o.error}</p>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
