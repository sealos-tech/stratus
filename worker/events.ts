// Incidents and maintenances published from the admin console.
import type {
  ApiEvent,
  ApiEventUpdate,
  ApiOutage,
  ComponentRef,
  EventKind,
  EventStatus,
  Impact,
} from '../shared/types'
import type { Env } from './env'

export interface EventRow {
  id: number
  kind: EventKind
  title: string
  impact: Impact
  status: EventStatus
  components: string
  starts_at: number
  ends_at: number | null
  created_at: number
  updated_at: number
}

interface UpdateRow {
  id: number
  event_id: number
  status: EventStatus
  body: string
  created_at: number
}

export interface OutageRow {
  id: number
  zone: string
  monitor: string
  start_ts: number
  end_ts: number | null
  error: string
  errors: string
  notified: number
}

export function toOutage(r: OutageRow): ApiOutage {
  return { id: r.id, zone: r.zone, monitor: r.monitor, start: r.start_ts, end: r.end_ts, error: r.error, errors: JSON.parse(r.errors) }
}

/** Maintenance status follows its window unless it was completed early. */
export function effectiveStatus(row: Pick<EventRow, 'kind' | 'status' | 'starts_at' | 'ends_at'>, now: number): EventStatus {
  if (row.kind !== 'maintenance' || row.status === 'completed') return row.status
  if (now < row.starts_at) return 'scheduled'
  if (row.ends_at !== null && now >= row.ends_at) return 'completed'
  return 'in_progress'
}

export function isActive(e: ApiEvent): boolean {
  return e.kind === 'incident' ? e.status !== 'resolved' : e.status === 'in_progress'
}

export function covers(components: ComponentRef[], zone: string, monitor?: string): boolean {
  if (components.length === 0) return true
  return components.some((c) => c.zone === zone && (!c.monitor || !monitor || c.monitor === monitor))
}

export function zonesOf(components: ComponentRef[]): string[] | null {
  return components.length === 0 ? null : [...new Set(components.map((c) => c.zone))]
}

async function withUpdates(env: Env, rows: EventRow[], now: number): Promise<ApiEvent[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const { results } = await env.DB.prepare(
    `SELECT id, event_id, status, body, created_at FROM event_updates
     WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC, id DESC`
  )
    .bind(JSON.stringify(ids))
    .all<UpdateRow>()
  const byEvent = new Map<number, ApiEventUpdate[]>()
  for (const u of results) {
    const list = byEvent.get(u.event_id) ?? []
    list.push({ id: u.id, status: u.status, body: u.body, createdAt: u.created_at })
    byEvent.set(u.event_id, list)
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    impact: r.impact,
    status: effectiveStatus(r, now),
    components: JSON.parse(r.components) as ComponentRef[],
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updates: byEvent.get(r.id) ?? [],
  }))
}

const COLUMNS = 'id, kind, title, impact, status, components, starts_at, ends_at, created_at, updated_at'

/** Events overlapping [from, to), plus every unresolved incident and upcoming maintenance. */
export async function listEvents(env: Env, from: number, to: number, now: number): Promise<ApiEvent[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM events
     WHERE (starts_at < ?2 AND (ends_at IS NULL OR ends_at >= ?1))
        OR (kind = 'incident' AND status != 'resolved')
        OR (kind = 'maintenance' AND starts_at >= ?3 AND status != 'completed')
     ORDER BY starts_at DESC LIMIT 500`
  )
    .bind(from, to, now)
    .all<EventRow>()
  return withUpdates(env, results, now)
}

export async function getEvent(env: Env, id: number, now: number): Promise<ApiEvent | null> {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?`).bind(id).first<EventRow>()
  return row ? (await withUpdates(env, [row], now))[0] : null
}

/** Components under maintenance right now (failed checks there count as maintenance). */
export async function activeMaintenanceComponents(env: Env, now: number): Promise<ComponentRef[][]> {
  const { results } = await env.DB.prepare(
    `SELECT components FROM events WHERE kind = 'maintenance' AND status != 'completed'
       AND starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1)`
  )
    .bind(now)
    .all<{ components: string }>()
  return results.map((r) => JSON.parse(r.components) as ComponentRef[])
}
