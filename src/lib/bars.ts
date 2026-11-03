// Builds the per-day bars (color + tooltip lines) for a zone or a page.
import { IMPACT_SEVERITY, countsOf, eventsOnDay, measuredSeverity, sumDays, worst, type Severity } from '$shared/status'
import { addDays, dayStart } from '$shared/time'
import type { ApiEvent, ApiOutage, DayCounts } from '$shared/types'
import type { BarDay } from '$lib/components/UptimeBars.svelte'
import { fmtDuration, loc, t } from '$lib/i18n.svelte'
import type { Localized } from '$shared/types'

interface Input {
  days: string[]
  /** Per page: day counts aligned with `days`. */
  series: { id: string; name: Localized; days: DayCounts[] }[]
  zone: string
  /** Set when the bars are for a single page. */
  monitor?: string
  events: ApiEvent[]
  outages?: ApiOutage[]
  timeZone: string
}

export function buildBars({ days, series, zone, monitor, events, outages = [], timeZone }: Input): BarDay[] {
  return days.map((day, i) => {
    const from = dayStart(day, timeZone)
    const to = dayStart(addDays(day, 1), timeZone)
    let severity: Severity = 'nodata'
    const items: BarDay['items'] = []

    // Published events take precedence and link to their page.
    for (const e of eventsOnDay(events, day, timeZone, zone, monitor)) {
      const s = IMPACT_SEVERITY[e.impact]
      severity = worst(severity, s)
      items.push({ severity: s, text: e.title, href: `/incidents/${e.id}` })
    }

    // Measured minutes of every page of this zone (or the single page).
    const measured = measuredSeverity(sumDays(series.map((m) => m.days[i])))
    if (measured !== 'nodata') severity = worst(severity === 'nodata' ? 'up' : severity, measured)

    // Pages that failed checks that day, with total downtime.
    for (const m of series) {
      const c = countsOf(m.days[i])
      if (c.down > 0) {
        const s = measuredSeverity(c)
        const lasting = outages.filter((o) => o.monitor === m.id && o.start < to && (o.end ?? Infinity) >= from)
        const minutes = lasting.length
          ? lasting.reduce((acc, o) => acc + Math.min(o.end ?? to, to) - Math.max(o.start, from), 0)
          : c.down * 60
        items.push({
          severity: s,
          text: `${monitor ? t('detected') : loc(m.name)} · ${t('down')} ${fmtDuration(minutes)}`,
        })
      } else if (c.degraded > 0) {
        items.push({ severity: 'degraded', text: `${monitor ? t('detected') : loc(m.name)} · ${t('degradedShort')} ${fmtDuration(c.degraded * 60)}` })
      }
    }

    return { day, severity, items, empty: severity === 'nodata' ? t('noData') : t('noIncidents') }
  })
}
