<script lang="ts" module>
  import type { Severity } from '$shared/status'

  export interface BarDay {
    day: string
    severity: Severity
    /** Lines shown in the tooltip under the date. */
    items: { severity: Severity; text: string; href?: string }[]
    /** Shown when there are no items. */
    empty: string
  }
</script>

<script lang="ts">
  // 5px bars with rounded corners in a stretched SVG; hover shows a card under the bar.
  import StatusIcon from './StatusIcon.svelte'
  import { fmtDay } from '$lib/i18n.svelte'
  import { link } from '$lib/router.svelte'

  let { bars, onSelect }: { bars: BarDay[]; onSelect?: (day: string) => void } = $props()

  const BAR = 5
  const STEP = 7.34
  const FILL: Record<Severity, string> = {
    up: 'var(--up)',
    degraded: 'var(--degraded)',
    partial: 'var(--partial)',
    major: 'var(--down)',
    maintenance: 'var(--maintenance)',
    nodata: 'var(--nodata)',
  }

  let width = $state(0)
  let hover = $state<number | null>(null)
  let pinned = $state(false)
  let leaveTimer: ReturnType<typeof setTimeout> | undefined

  const viewWidth = $derived(bars.length > 0 ? (bars.length - 1) * STEP + BAR : 1)
  const centerX = (i: number) => ((i * STEP + BAR / 2) / viewWidth) * width

  function enter(i: number) {
    clearTimeout(leaveTimer)
    hover = i
  }
  function leave() {
    clearTimeout(leaveTimer)
    // Small delay so the pointer can move into the tooltip to click a link.
    leaveTimer = setTimeout(() => {
      if (!pinned) hover = null
    }, 120)
  }
</script>

<div class="relative mt-2" bind:clientWidth={width} role="presentation" onmouseleave={leave}>
  <svg
    class="block h-4 w-full"
    viewBox="0 0 {viewWidth} 16"
    preserveAspectRatio="none"
    role="img"
    aria-label="{bars.length} day history"
    data-testid="uptime-bars"
  >
    {#each bars as bar, i (bar.day)}
      <rect
        x={i * STEP}
        y="0"
        width={BAR}
        height="16"
        rx="1"
        fill={FILL[bar.severity]}
        class="cursor-pointer transition-opacity {hover !== null && hover !== i ? 'opacity-60' : ''}"
        data-day={bar.day}
        data-severity={bar.severity}
        role="button"
        tabindex="-1"
        onmouseenter={() => enter(i)}
        onclick={() => onSelect?.(bar.day)}
        onkeydown={(e) => e.key === 'Enter' && onSelect?.(bar.day)}
      />
    {/each}
  </svg>

  {#if hover !== null && width > 0}
    {@const bar = bars[hover]}
    {@const left = Math.min(Math.max(centerX(hover) - 128, 0), Math.max(width - 256, 0))}
    <div
      class="absolute top-full z-[90] w-64 pt-1"
      style="left: {left}px"
      role="tooltip"
      data-testid="bar-tooltip"
      onmouseenter={() => {
        clearTimeout(leaveTimer)
        pinned = true
      }}
      onmouseleave={() => {
        pinned = false
        leave()
      }}
    >
      <div class="bg-popover text-popover-foreground w-full rounded-md border border-[#e4e4e7] p-1 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.03),0_1px_4px_rgba(0,0,0,0.03)] dark:border-border">
        <div class="text-subtle p-1 whitespace-nowrap">{fmtDay(bar.day)}</div>
        {#if bar.items.length === 0}
          <div class="flex items-center gap-2 px-2 py-1 font-medium">
            <StatusIcon severity={bar.severity === 'nodata' ? 'nodata' : 'up'} />{bar.empty}
          </div>
        {:else}
          {#each bar.items as item, k (k)}
            {#if item.href}
              <a href={item.href} onclick={link} class="hover:bg-secondary flex min-h-8 items-start gap-2 rounded px-2 py-1 font-medium">
                <StatusIcon severity={item.severity} class="mt-0.5" /><span class="text-left">{item.text}</span>
              </a>
            {:else}
              <div class="flex min-h-8 items-start gap-2 px-2 py-1 font-medium">
                <StatusIcon severity={item.severity} class="mt-0.5" /><span class="text-left">{item.text}</span>
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
