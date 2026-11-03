// One monitoring round, run by the cron trigger every minute.
import { retention } from '../status.config'
import { localParts } from '../shared/time'
import type { ComponentRef, SampleCode, ZoneConfig } from '../shared/types'
import { getConfig } from './config'
import type { Env } from './env'
import { activeMaintenanceComponents, covers, type OutageRow } from './events'
import { drainOutbox, enqueueStatement, notifyTeam, type Notice, type NoticeOutage } from './notify'
import type { ZoneProbe } from './prober'
import { addSample, emptyTotals, key, loadState, pruneState, saveStateStatement } from './state'

const EMPTY_MINUTES = '.'.repeat(1440)
const EMPTY_LATENCIES = '0000'.repeat(1440)

async function probeAll(env: Env, zones: ZoneConfig[], timeoutMs: number): Promise<ZoneProbe[]> {
  return Promise.all(
    zones.map(async (zone) => {
      try {
        // The location hint only applies when the object is first created, so it is part of the name.
        const stub = env.PROBER.get(env.PROBER.idFromName(`${zone.id}@${zone.probe}`), { locationHint: zone.probe })
        return await stub.probe(zone.monitors, timeoutMs)
      } catch (e) {
        // A probe that could not run says nothing about the zone: record nothing rather than an outage.
        console.error(`probe of zone ${zone.id} failed`, e)
        return { colo: null, results: [] }
      }
    })
  )
}

export async function runChecks(env: Env, scheduledTime: number): Promise<void> {
  const config = await getConfig(env)
  const now = Math.floor(scheduledTime / 60000) * 60
  const { day, minute } = localParts(now, config.site.timezone)

  const [probes, state, open, maintenance] = await Promise.all([
    probeAll(env, config.zones, config.probe.timeoutMs),
    loadState(env, config, now),
    env.DB.prepare(`SELECT id, zone, monitor, start_ts, end_ts, error, errors, notified FROM outages WHERE end_ts IS NULL`)
      .all<OutageRow>()
      .then((r) => r.results),
    activeMaintenanceComponents(env, now),
  ])
  const openByKey = new Map(open.map((i) => [key(i.zone, i.monitor), i]))
  const inMaintenance = (zone: string, monitor: string) => maintenance.some((c: ComponentRef[]) => covers(c, zone, monitor))

  const writes: D1PreparedStatement[] = []
  const changes: NoticeOutage[] = []

  config.zones.forEach((zone, zi) => {
    const { colo, results } = probes[zi]
    if (results.length > 0) state.colo[zone.id] = colo
    for (const result of results) {
      const monitor = zone.monitors.find((m) => m.id === result.id)!
      const k = key(zone.id, monitor.id)
      const code: SampleCode = result.ok
        ? result.latency > config.probe.degradedMs
          ? 'd'
          : 'u'
        : inMaintenance(zone.id, monitor.id)
          ? 'm'
          : 'x'
      const latency = Math.min(result.latency, 0xffff)

      // A second run within the same minute (retry, manual trigger) must not count twice.
      const firstThisMinute = state.latest[k]?.ts !== now
      state.latest[k] = { ts: now, s: code, lat: latency, code: result.code, err: result.error, colo }
      if (firstThisMinute) addSample(((state.days[k] ??= {})[day] ??= emptyTotals()), code, latency)

      const counter = (c: SampleCode) => (c === code ? 1 : 0)
      writes.push(
        env.DB.prepare(
          `INSERT INTO daily (zone, monitor, day, up, degraded, down, maintenance, latency_sum, latency_count,
             latency_min, latency_max, minutes, latencies)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, iif(?8 > 0, 1, 0), nullif(?8, 0), nullif(?8, 0),
             substr(?9, 1, ?10) || ?11 || substr(?9, ?10 + 2),
             substr(?12, 1, ?10 * 4) || ?13 || substr(?12, ?10 * 4 + 5))
           ON CONFLICT (zone, monitor, day) DO UPDATE SET
             up = up + iif(substr(minutes, ?10 + 1, 1) = '.', ?4, 0),
             degraded = degraded + iif(substr(minutes, ?10 + 1, 1) = '.', ?5, 0),
             down = down + iif(substr(minutes, ?10 + 1, 1) = '.', ?6, 0),
             maintenance = maintenance + iif(substr(minutes, ?10 + 1, 1) = '.', ?7, 0),
             latency_sum = latency_sum + iif(substr(minutes, ?10 + 1, 1) = '.', ?8, 0),
             latency_count = latency_count + iif(substr(minutes, ?10 + 1, 1) = '.' AND ?8 > 0, 1, 0),
             latency_min = iif(?8 > 0, min(coalesce(latency_min, ?8), ?8), latency_min),
             latency_max = iif(?8 > 0, max(coalesce(latency_max, ?8), ?8), latency_max),
             minutes = substr(minutes, 1, ?10) || ?11 || substr(minutes, ?10 + 2),
             latencies = substr(latencies, 1, ?10 * 4) || ?13 || substr(latencies, ?10 * 4 + 5)`
        ).bind(
          zone.id,
          monitor.id,
          day,
          counter('u'),
          counter('d'),
          counter('x'),
          counter('m'),
          // A failed check has no response time; its timeout must not skew the day's statistics.
          code === 'x' ? 0 : latency,
          EMPTY_MINUTES,
          minute,
          code,
          EMPTY_LATENCIES,
          latency.toString(16).padStart(4, '0')
        )
      )

      const outage = openByKey.get(k)
      const base = { zone: zone.id, zoneName: zone.name, monitorName: monitor.name, url: monitor.url }
      if (code === 'x') {
        const error = result.error ?? 'Unknown error'
        if (!outage) {
          writes.push(
            env.DB.prepare(`INSERT INTO outages (zone, monitor, start_ts, error, errors, notified) VALUES (?, ?, ?, ?, ?, ?)`).bind(
              zone.id,
              monitor.id,
              now,
              error,
              JSON.stringify([[now, error]]),
              config.graceMinutes <= 0 ? 1 : 0
            )
          )
          if (config.graceMinutes <= 0) changes.push({ ...base, kind: 'down', since: now, minutes: 0, error })
        } else {
          if (outage.error !== error) {
            const errors = JSON.parse(outage.errors) as [number, string][]
            errors.push([now, error])
            writes.push(
              env.DB.prepare(`UPDATE outages SET error = ?, errors = ? WHERE id = ?`).bind(error, JSON.stringify(errors), outage.id)
            )
          }
          if (!outage.notified && now - outage.start_ts >= config.graceMinutes * 60) {
            writes.push(env.DB.prepare(`UPDATE outages SET notified = 1 WHERE id = ?`).bind(outage.id))
            changes.push({ ...base, kind: 'down', since: outage.start_ts, minutes: (now - outage.start_ts) / 60, error })
          }
        }
      } else if (outage) {
        writes.push(env.DB.prepare(`UPDATE outages SET end_ts = ? WHERE id = ?`).bind(now, outage.id))
        if (outage.notified) {
          changes.push({ ...base, kind: 'up', since: outage.start_ts, minutes: (now - outage.start_ts) / 60, error: outage.error })
        }
      }
    }
  })

  // Outages of pages removed from the configuration would stay open forever.
  const configured = new Set(config.zones.flatMap((z) => z.monitors.map((m) => key(z.id, m.id))))
  for (const outage of open) {
    if (!configured.has(key(outage.zone, outage.monitor))) {
      writes.push(env.DB.prepare(`UPDATE outages SET end_ts = ? WHERE id = ?`).bind(now, outage.id))
    }
  }

  // One notice per zone, so a subscriber of a single zone only hears about that zone.
  if (changes.length > 0) {
    for (const zoneId of new Set(changes.map((c) => c.zone))) {
      const notice: Notice = { type: 'outages', at: now, items: changes.filter((c) => c.zone === zoneId) }
      writes.push(enqueueStatement(env, notice, [zoneId], true, now))
    }
  }

  pruneState(state, config, now)
  writes.push(saveStateStatement(env, state))
  await env.DB.batch(writes)

  if (changes.length > 0) await notifyTeam(config, { type: 'outages', at: now, items: changes })
  await drainOutbox(env, config, now)
}

/** Daily cleanup: minute detail and rows past their retention. */
export async function cleanup(env: Env, now: number): Promise<void> {
  const config = await getConfig(env)
  const dayBefore = (days: number) => localParts(now - days * 86400, config.site.timezone).day
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM daily WHERE day < ?`).bind(dayBefore(retention.dailyDays)),
    env.DB.prepare(`UPDATE daily SET minutes = '', latencies = '' WHERE day < ? AND minutes != ''`).bind(dayBefore(retention.minuteDays)),
    env.DB.prepare(`DELETE FROM outages WHERE end_ts IS NOT NULL AND end_ts < ?`).bind(now - retention.dailyDays * 86400),
    env.DB.prepare(`DELETE FROM outbox WHERE status IN ('sent', 'failed') AND created_at < ?`).bind(now - 30 * 86400),
    env.DB.prepare(`DELETE FROM subscribers WHERE verified = 0 AND created_at < ?`).bind(now - 7 * 86400),
  ])
}
