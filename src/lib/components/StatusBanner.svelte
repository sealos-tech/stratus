<script lang="ts">
  // Overall status card: tinted header with icon + title, white body.
  import StatusIcon from './StatusIcon.svelte'
  import type { Severity } from '$shared/status'
  import type { Snippet } from 'svelte'

  let { severity, title, children }: { severity: Severity; title: string; children?: Snippet } = $props()

  const FRAME: Record<Severity, string> = {
    up: 'var(--up)',
    degraded: 'var(--degraded)',
    partial: 'var(--partial)',
    major: 'var(--down)',
    maintenance: 'var(--maintenance)',
    nodata: 'var(--border)',
  }
  const SOFT: Record<Severity, string> = {
    up: 'var(--up-soft)',
    degraded: 'var(--degraded-soft)',
    partial: 'var(--partial-soft)',
    major: 'var(--down-soft)',
    maintenance: 'var(--maintenance-soft)',
    nodata: 'var(--secondary)',
  }
</script>

<div class="status-card" style="--frame: {FRAME[severity]}" data-testid="status-banner" data-severity={severity}>
  <div class="status-card-body">
    <div class="flex items-center gap-2 rounded-t-[7px] px-4 py-3.5 text-base font-medium" style="background: {SOFT[severity]}">
      <StatusIcon {severity} />
      <h1>{title}</h1>
    </div>
    {#if children}
      <div class="p-4 text-sm">{@render children()}</div>
    {/if}
  </div>
</div>
