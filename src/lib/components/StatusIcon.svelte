<script lang="ts">
  // Filled circle with a white glyph.
  import type { Severity } from '$shared/status'

  let { severity, size = 16, class: className = '' }: { severity: Severity; size?: number; class?: string } = $props()

  const FILL: Record<Severity, string> = {
    up: 'var(--up)',
    degraded: 'var(--degraded)',
    partial: 'var(--partial)',
    major: 'var(--down)',
    maintenance: 'var(--maintenance)',
    nodata: 'var(--subtle)',
  }
</script>

<svg width={size} height={size} viewBox="0 0 16 16" class="shrink-0 {className}" aria-hidden="true" data-severity={severity}>
  <circle cx="8" cy="8" r="8" fill={FILL[severity]} />
  {#if severity === 'up'}
    <path d="M4.75 8.25 7 10.5l4.25-4.75" fill="none" stroke="white" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
  {:else if severity === 'major' || severity === 'partial'}
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="white" stroke-width="1.75" stroke-linecap="round" />
  {:else if severity === 'degraded'}
    <path d="M8 4.5v4.25" stroke="white" stroke-width="1.75" stroke-linecap="round" />
    <circle cx="8" cy="11.25" r="1" fill="white" />
  {:else if severity === 'maintenance'}
    <path d="M5 11l3.6-3.6M9.3 4.9a2 2 0 0 0 2.7 2.7l-.9-.2-.3-.3-.2-.9z" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  {:else}
    <path d="M6.5 6.25a1.5 1.5 0 1 1 2.1 1.4c-.4.2-.6.5-.6.9v.2" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" />
    <circle cx="8" cy="11.25" r=".9" fill="white" />
  {/if}
</svg>
