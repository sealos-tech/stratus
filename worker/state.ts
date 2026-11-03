// The "state" row: latest result and per-day counts of every page, enough to render the whole
// status page from a single read.
import { addDays, localParts } from '../shared/time'
import type { SampleCode } from '../shared/types'
import type { ResolvedConfig } from './config'
import type { Env } from './env'

export interface Latest {
  ts: number
  s: SampleCode
  lat: number
  code: number | null
  err: string | null
  colo: string | null
}

/** [up, degraded, down, maintenance, latency sum, latency count, latency min, latency max] */
export type DayTotals = [number, number, number, number, number, number, number, number]

export interface State {
  v: 1
  colo: Record<string, string | null>
  latest: Record<string, Latest>
  /** `<zone>/<monitor>` → day → totals */
  days: Record<string, Record<string, DayTotals>>
}

export const CODE_INDEX: Record<SampleCode, number> = { u: 0, d: 1, x: 2, m: 3 }

export const key = (zone: string, monitor: string) => `${zone}/${monitor}`

export function emptyTotals(): DayTotals {
  return [0, 0, 0, 0, 0, 0, 0, 0]
}

export function addSample(t: DayTotals, code: SampleCode, latency: number): void {
  t[CODE_INDEX[code]]++
  if (latency > 0 && code !== 'x') {
    t[4] += latency
    t[5]++
    t[6] = t[6] === 0 ? latency : Math.min(t[6], latency)
    t[7] = Math.max(t[7], latency)
  }
}

interface DailyTotalsRow {
  zone: string
  monitor: string
  day: string
  up: number
  degraded: number
  down: number
  maintenance: number
  latency_sum: number
  latency_count: number
  latency_min: number | null
  latency_max: number | null
}

export function firstDay(config: ResolvedConfig, now: number): string {
  return addDays(localParts(now, config.site.timezone).day, -config.site.historyDays)
}

export async function loadState(env: Env, config: ResolvedConfig, now: number): Promise<State> {
  const row = await env.DB.prepare(`SELECT value FROM kv WHERE key = 'state'`).first<{ value: string }>()
  if (row) return JSON.parse(row.value) as State

  // No state yet (first run, or imported history): rebuild the day totals from the daily table.
  const state: State = { v: 1, colo: {}, latest: {}, days: {} }
  const { results } = await env.DB.prepare(
    `SELECT zone, monitor, day, up, degraded, down, maintenance, latency_sum, latency_count, latency_min, latency_max
     FROM daily WHERE day >= ?`
  )
    .bind(firstDay(config, now))
    .all<DailyTotalsRow>()
  for (const r of results) {
    ;(state.days[key(r.zone, r.monitor)] ??= {})[r.day] = [
      r.up,
      r.degraded,
      r.down,
      r.maintenance,
      r.latency_sum,
      r.latency_count,
      r.latency_min ?? 0,
      r.latency_max ?? 0,
    ]
  }
  return state
}

/** Drops days that left the history window. */
export function pruneState(state: State, config: ResolvedConfig, now: number): void {
  const first = firstDay(config, now)
  for (const [k, days] of Object.entries(state.days)) {
    for (const day of Object.keys(days)) if (day < first) delete days[day]
    if (Object.keys(days).length === 0) delete state.days[k]
  }
}

export function saveStateStatement(env: Env, state: State): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO kv (key, value) VALUES ('state', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).bind(JSON.stringify(state))
}
