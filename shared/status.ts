// Status math shared by Worker and UI.
import { addDays, dayStart } from './time'
import type { ApiEvent, ComponentRef, DayCounts, Impact, Status } from './types'

export interface Counts {
  up: number
  degraded: number
  down: number
  maintenance: number
}

/** Color class of a day bar or a component, worst last. */
export type Severity = 'nodata' | 'up' | 'maintenance' | 'degraded' | 'partial' | 'major'

export const SEVERITY_RANK: Record<Severity, number> = { nodata: 0, up: 1, maintenance: 2, degraded: 3, partial: 4, major: 5 }

export const worst = (a: Severity, b: Severity): Severity => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a)

export const IMPACT_SEVERITY: Record<Impact, Severity> = { degraded: 'degraded', partial: 'partial', major: 'major', maintenance: 'maintenance' }

export function total(c: Counts): number {
  return c.up + c.degraded + c.down + c.maintenance
}

export const countsOf = (d: DayCounts): Counts => ({ up: d[0], degraded: d[1], down: d[2], maintenance: d[3] })

export function sumDays(list: DayCounts[]): Counts {
  const c: Counts = { up: 0, degraded: 0, down: 0, maintenance: 0 }
  for (const d of list) {
    c.up += d[0]
    c.degraded += d[1]
    c.down += d[2]
    c.maintenance += d[3]
  }
  return c
}

/**
 * Share of a day's checks that must be slow before the day itself counts as slow. One slow minute
 * out of 1,440 is noise; a day that is really slow stays slow for far longer than that.
 */
export const SLOW_DAY_SHARE = 0.01
/** Slow minutes a day needs before it can be marked slow, so a blip early in the day does not count. */
export const SLOW_DAY_MINUTES = 3

/** Severity measured by the probes: any failed minute marks the day, 5%+ of the day is a major outage. */
export function measuredSeverity(c: Counts): Severity {
  const all = total(c)
  if (all === 0) return 'nodata'
  if (c.down > 0) return c.down / all >= 0.05 ? 'major' : 'partial'
  if (c.degraded >= SLOW_DAY_MINUTES && c.degraded / all >= SLOW_DAY_SHARE) return 'degraded'
  if (c.maintenance > 0) return 'maintenance'
  return 'up'
}

/**
 * Severity of a group of pages: some pages down is a partial outage, half or more down is a
 * major outage (a single failing page must not turn the whole page red).
 */
export function rollUp(pages: Severity[]): Severity {
  const measured = pages.filter((s) => s !== 'nodata')
  if (measured.length === 0) return 'nodata'
  const down = measured.filter((s) => s === 'major' || s === 'partial').length
  let s = measured.reduce<Severity>((acc, x) => (x === 'major' || x === 'partial' ? acc : worst(acc, x)), 'up')
  if (down > 0) s = worst(s, down * 2 >= measured.length ? 'major' : 'partial')
  return s
}

export function statusSeverity(s: Status): Severity {
  return s === 'down' ? 'major' : s === 'degraded' ? 'degraded' : s === 'maintenance' ? 'maintenance' : s === 'nodata' ? 'nodata' : 'up'
}

/** Uptime text: "100" only without any failed minute, otherwise floored to 2 decimals. */
export function uptime(c: Counts): string | null {
  const all = total(c)
  if (all === 0) return null
  const ok = c.up + c.degraded + c.maintenance
  if (ok === all) return '100'
  return (Math.floor((ok / all) * 10000) / 100).toFixed(2)
}

export function formatLatency(ms: number | null | undefined): string {
  if (!ms) return '-'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function covers(components: ComponentRef[], zone: string, monitor?: string): boolean {
  if (components.length === 0) return true
  return components.some((c) => c.zone === zone && (!c.monitor || !monitor || c.monitor === monitor))
}

/** Published events overlapping a local day that affect a zone (and page). */
export function eventsOnDay(events: ApiEvent[], day: string, timeZone: string, zone: string, monitor?: string): ApiEvent[] {
  const from = dayStart(day, timeZone)
  const to = dayStart(addDays(day, 1), timeZone)
  return events.filter((e) => e.startsAt < to && (e.endsAt ?? Infinity) >= from && e.status !== 'scheduled' && covers(e.components, zone, monitor))
}
