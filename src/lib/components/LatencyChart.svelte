<script lang="ts">
  // Response-time area chart with hover readout.
  import { area, curveMonotoneX, line } from 'd3-shape'
  import { formatLatency } from '$shared/status'
  import { t } from '$lib/i18n.svelte'

  interface Point {
    x: number
    value: number
    label: string
  }

  let { points, height = 140, ticks = [] }: { points: Point[]; height?: number; ticks?: { x: number; label: string }[] } = $props()

  let width = $state(0)
  let hover = $state<Point | null>(null)
  const id = `lg-${Math.random().toString(36).slice(2)}`
  const axis = 18
  const plot = $derived(height - axis)
  const data = $derived(points.filter((p) => p.value > 0))
  const xMin = $derived(points.length ? points[0].x : 0)
  const xMax = $derived(points.length ? points[points.length - 1].x : 1)
  const yMax = $derived(Math.max(1, ...data.map((p) => p.value)) * 1.15)
  const sx = (x: number) => (xMax === xMin ? width / 2 : ((x - xMin) / (xMax - xMin)) * width)
  const sy = (v: number) => plot - (v / yMax) * (plot - 4)
  const areaPath = $derived(area<Point>().x((p) => sx(p.x)).y0(plot).y1((p) => sy(p.value)).curve(curveMonotoneX)(data) ?? '')
  const linePath = $derived(line<Point>().x((p) => sx(p.x)).y((p) => sy(p.value)).curve(curveMonotoneX)(data) ?? '')

  function onMove(event: MouseEvent) {
    if (!data.length) return
    const mx = event.clientX - (event.currentTarget as SVGElement).getBoundingClientRect().left
    hover = data.reduce((best, p) => (Math.abs(sx(p.x) - mx) < Math.abs(sx(best.x) - mx) ? p : best), data[0])
  }
</script>

<div class="relative w-full" bind:clientWidth={width} style="height: {height}px" data-testid="latency-chart">
  {#if data.length === 0}
    <div class="text-muted-foreground flex h-full items-center justify-center text-sm">{t('noData')}</div>
  {:else if width > 0}
    <svg {width} {height} role="img" aria-label={t('responseTime')} onmousemove={onMove} onmouseleave={() => (hover = null)}>
      <defs>
        <linearGradient {id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--up)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--up)" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#{id})" />
      <path d={linePath} fill="none" stroke="var(--up)" stroke-width="1.5" />
      {#each ticks as tick, i (tick.x)}
        <text
          x={sx(tick.x)}
          y={height - 3}
          text-anchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
          class="fill-subtle text-[11px]">{tick.label}</text
        >
      {/each}
      {#if hover}
        <line x1={sx(hover.x)} x2={sx(hover.x)} y1="0" y2={plot} stroke="var(--border)" />
        <circle cx={sx(hover.x)} cy={sy(hover.value)} r="3.5" fill="var(--up)" stroke="var(--card)" stroke-width="2" />
      {/if}
    </svg>
    {#if hover}
      <div
        class="bg-popover pointer-events-none absolute -top-1 z-20 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm"
        style="left: {Math.min(Math.max(sx(hover.x), 60), width - 60)}px"
      >
        <span class="text-subtle">{hover.label}</span> <span class="ml-1 font-medium tabular-nums">{formatLatency(hover.value)}</span>
      </div>
    {/if}
  {/if}
</div>
