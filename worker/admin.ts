// Admin API: publish incidents and maintenances, manage subscribers, settings, test notifications.
// The console is opened as /admin?p=<ADMIN_TOKEN> and sends `Authorization: Bearer <p>`.
import {
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  MAINTENANCE_STATUSES,
  type ApiAdminOverview,
  type ApiSubscriber,
  type ComponentRef,
  type EventInput,
  type EventStatus,
  type Localized,
} from '../shared/types'
import { validateSubscription } from './api'
import { HttpError, json, sha256 } from './http'
import type { SettingsInput } from '../shared/settings'
import type { ApiProbeResult } from '../shared/types'
import { adminView, getConfig, loadSettings, resolve, saveSettings, validateSettings, zoneIndex, type ResolvedConfig } from './config'
import { checkPage } from './prober'
import type { Env } from './env'
import { effectiveStatus, getEvent, listEvents, toOutage, zonesOf, type EventRow, type OutageRow } from './events'
import { drainOutbox, enqueueStatement, notifyTeam, sendWebhook, webhookFlavor, type Notice, type NoticeEvent, type WebhookFlavor } from './notify'

/** A short token can be guessed from many IPs at once; the per-IP limit alone does not stop that. */
export const MIN_TOKEN_LENGTH = 16
/** Failed attempts in a row from one IP before it is blocked. */
export const MAX_FAILURES = 30
const BLOCK_SECONDS = 3600
/** Failures further apart than this do not add up. */
const FAILURE_WINDOW = 3600

async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Checks the admin token with a per-IP limit: after MAX_FAILURES wrong tokens in a row the IP is
 * refused for an hour, even with the right token, so guessing gets nowhere.
 */
async function authorize(request: Request, env: Env, now: number): Promise<void> {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < MIN_TOKEN_LENGTH) {
    throw new HttpError(503, `admin is disabled: set the ADMIN_TOKEN secret (at least ${MIN_TOKEN_LENGTH} characters)`)
  }
  const ipHash = await sha256(`${request.headers.get('cf-connecting-ip') ?? 'local'}:admin`)
  const row = await env.DB.prepare(`SELECT failures, last_at, blocked_until FROM auth_failures WHERE ip_hash = ?`)
    .bind(ipHash)
    .first<{ failures: number; last_at: number; blocked_until: number | null }>()
  const blocked = (until: number) =>
    new HttpError(429, `too many failed attempts, try again in ${Math.ceil((until - now) / 60)} minutes`, { 'retry-after': String(until - now) })
  if (row?.blocked_until && row.blocked_until > now) throw blocked(row.blocked_until)

  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (await tokenMatches(given, env.ADMIN_TOKEN)) {
    if (row) await env.DB.prepare(`DELETE FROM auth_failures WHERE ip_hash = ?`).bind(ipHash).run()
    return
  }
  const failures = row && now - row.last_at < FAILURE_WINDOW ? row.failures + 1 : 1
  const blockedUntil = failures >= MAX_FAILURES ? now + BLOCK_SECONDS : null
  await env.DB.prepare(
    `INSERT INTO auth_failures (ip_hash, failures, last_at, blocked_until) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (ip_hash) DO UPDATE SET failures = ?2, last_at = ?3, blocked_until = ?4`
  )
    .bind(ipHash, failures, now, blockedUntil)
    .run()
  if (blockedUntil) throw blocked(blockedUntil)
  throw new HttpError(401, 'invalid admin link')
}

function componentNames(config: ResolvedConfig, components: ComponentRef[]): Localized[] {
  return components.map((c) => {
    const zone = config.zones.find((z) => z.id === c.zone)
    const monitor = zone?.monitors.find((m) => m.id === c.monitor)
    if (!zone) return c.zone
    if (!monitor) return zone.name
    const zn = zone.name
    const mn = monitor.name
    return {
      zh: `${typeof zn === 'string' ? zn : zn.zh} · ${typeof mn === 'string' ? mn : mn.zh}`,
      en: `${typeof zn === 'string' ? zn : zn.en} · ${typeof mn === 'string' ? mn : mn.en}`,
    }
  })
}

function validComponents(config: ResolvedConfig, list: unknown): ComponentRef[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((c): c is ComponentRef => !!c && typeof c.zone === 'string')
    .filter((c) => {
      const zone = config.zones.find((z) => z.id === c.zone)
      return zone && (!c.monitor || zone.monitors.some((m) => m.id === c.monitor))
    })
    .map((c) => (c.monitor ? { zone: c.zone, monitor: c.monitor } : { zone: c.zone }))
}

function checkStatus(kind: string, status: string): EventStatus {
  const allowed: string[] = kind === 'maintenance' ? MAINTENANCE_STATUSES : INCIDENT_STATUSES
  if (!allowed.includes(status)) throw new HttpError(400, `status must be one of ${allowed.join(', ')}`)
  return status as EventStatus
}

async function announce(env: Env, config: ResolvedConfig, row: EventRow, body: string, first: boolean, now: number) {
  const components = JSON.parse(row.components) as ComponentRef[]
  const event: NoticeEvent = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    impact: row.impact,
    status: effectiveStatus(row, now),
    body,
    components: componentNames(config, components),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }
  const notice: Notice = { type: 'event', at: now, first, event }
  await enqueueStatement(env, notice, zonesOf(components), false, now).run()
  await notifyTeam(config, notice)
  await drainOutbox(env, config, now)
}

async function createEvent(env: Env, config: ResolvedConfig, input: EventInput, now: number) {
  const kind = input.kind === 'maintenance' ? 'maintenance' : 'incident'
  const title = String(input.title ?? '').trim()
  const body = String(input.body ?? '').trim()
  if (!title) throw new HttpError(400, 'title is required')
  if (!body) throw new HttpError(400, 'message is required')
  const status = checkStatus(kind, input.status ?? (kind === 'maintenance' ? 'scheduled' : 'investigating'))
  const impact = kind === 'maintenance' ? 'maintenance' : input.impact
  if (kind === 'incident' && !INCIDENT_IMPACTS.includes(impact)) throw new HttpError(400, 'impact must be degraded, partial or major')
  const startsAt = Number(input.startsAt) || now
  let endsAt = input.endsAt ? Number(input.endsAt) : null
  if (kind === 'incident' && status === 'resolved') endsAt = endsAt ?? now
  if (kind === 'maintenance' && endsAt !== null && endsAt <= startsAt) throw new HttpError(400, 'maintenance must end after it starts')
  const components = validComponents(config, input.components)

  const row = await env.DB.prepare(
    `INSERT INTO events (kind, title, impact, status, components, starts_at, ends_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, kind, title, impact, status, components, starts_at, ends_at, created_at, updated_at`
  )
    .bind(kind, title, impact, status, JSON.stringify(components), startsAt, endsAt, now, now)
    .first<EventRow>()
  await env.DB.prepare(`INSERT INTO event_updates (event_id, status, body, created_at) VALUES (?, ?, ?, ?)`).bind(row!.id, status, body, now).run()
  if (input.notify !== false) await announce(env, config, row!, body, true, now)
  return getEvent(env, row!.id, now)
}

async function addUpdate(env: Env, config: ResolvedConfig, id: number, input: { status: string; body: string; notify?: boolean; endsAt?: number | null }, now: number) {
  const row = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first<EventRow>()
  if (!row) throw new HttpError(404, 'event not found')
  const status = checkStatus(row.kind, input.status)
  const body = String(input.body ?? '').trim()
  if (!body) throw new HttpError(400, 'message is required')
  let endsAt = row.ends_at
  if (row.kind === 'incident') endsAt = status === 'resolved' ? now : null
  if (row.kind === 'maintenance' && input.endsAt !== undefined) endsAt = input.endsAt
  if (row.kind === 'maintenance' && status === 'completed') endsAt = Math.min(endsAt ?? now, now)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO event_updates (event_id, status, body, created_at) VALUES (?, ?, ?, ?)`).bind(id, status, body, now),
    env.DB.prepare(`UPDATE events SET status = ?, ends_at = ?, updated_at = ? WHERE id = ?`).bind(status, endsAt, now, id),
  ])
  if (input.notify !== false) await announce(env, config, { ...row, status, ends_at: endsAt }, body, false, now)
  return getEvent(env, id, now)
}

async function editEvent(env: Env, config: ResolvedConfig, id: number, input: Partial<EventInput>, now: number) {
  const row = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first<EventRow>()
  if (!row) throw new HttpError(404, 'event not found')
  const title = input.title !== undefined ? String(input.title).trim() || row.title : row.title
  const impact = row.kind === 'incident' && input.impact && INCIDENT_IMPACTS.includes(input.impact) ? input.impact : row.impact
  const components = input.components !== undefined ? JSON.stringify(validComponents(config, input.components)) : row.components
  const startsAt = input.startsAt !== undefined ? Number(input.startsAt) : row.starts_at
  const endsAt = input.endsAt !== undefined ? (input.endsAt === null ? null : Number(input.endsAt)) : row.ends_at
  await env.DB.prepare(`UPDATE events SET title = ?, impact = ?, components = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?`)
    .bind(title, impact, components, startsAt, endsAt, now, id)
    .run()
  return getEvent(env, id, now)
}

async function overview(env: Env, config: ResolvedConfig, now: number): Promise<ApiAdminOverview> {
  const [events, outages, subscribers, outbox] = await Promise.all([
    listEvents(env, now - 30 * 86400, now + 1, now),
    env.DB.prepare(
      `SELECT id, zone, monitor, start_ts, end_ts, error, errors, notified FROM outages
       WHERE end_ts IS NULL OR end_ts >= ? ORDER BY start_ts DESC LIMIT 50`
    )
      .bind(now - 7 * 86400)
      .all<OutageRow>()
      .then((r) => r.results.map(toOutage)),
    env.DB.prepare(`SELECT id, kind, target, zones, auto, lang, verified, created_at, last_error FROM subscribers ORDER BY id DESC LIMIT 500`)
      .all<{ id: number; kind: 'email' | 'webhook'; target: string; zones: string | null; auto: number; lang: 'en' | 'zh'; verified: number; created_at: number; last_error: string | null }>()
      .then((r) =>
        r.results.map(
          (s): ApiSubscriber => ({
            id: s.id,
            kind: s.kind,
            target: s.target,
            zones: s.zones ? JSON.parse(s.zones) : null,
            auto: s.auto === 1,
            lang: s.lang,
            verified: s.verified === 1,
            createdAt: s.created_at,
            lastError: s.last_error,
          })
        )
      ),
    env.DB.prepare(
      `SELECT sum(status IN ('pending', 'sending')) AS pending, sum(status = 'failed') AS failed,
         sum(status = 'sent' AND sent_at > ?) AS sent FROM outbox`
    )
      .bind(now - 86400)
      .first<{ pending: number | null; failed: number | null; sent: number | null }>(),
  ])
  return {
    events,
    outages,
    subscribers,
    outbox: { pending: outbox?.pending ?? 0, failed: outbox?.failed ?? 0, sent24h: outbox?.sent ?? 0 },
    config: {
      team: !!config.team,
      email: !!config.email,
      siteUrl: config.siteUrl,
      graceMinutes: config.graceMinutes,
    },
    zones: zoneIndex(config),
    timezone: config.site.timezone,
  }
}

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000)
  await authorize(request, env, now)
  const config = await getConfig(env)
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean) // api, admin, ...
  const method = request.method
  const body = method === 'GET' || method === 'DELETE' ? null : await request.json().catch(() => ({}))
  const route = parts.slice(2).join('/')
  const id = Number(parts[3])

  if (method === 'GET' && route === 'overview') return json(await overview(env, config, now))
  if (method === 'GET' && route === 'settings') return json(adminView(await loadSettings(env)))
  if (method === 'PUT' && route === 'settings') {
    const settings = validateSettings(body as SettingsInput, await loadSettings(env))
    await saveSettings(env, settings)
    return json(adminView(settings))
  }
  if (method === 'POST' && route === 'probe') {
    // Checks pages of unsaved settings from here (no regional placement), so a new zone can be
    // tried before it is saved.
    const draft = resolve(validateSettings(body as SettingsInput, await loadSettings(env)))
    const only = url.searchParams.get('zone')
    const pages = draft.zones.filter((z) => !only || z.id === only).flatMap((z) => z.monitors.map((m) => ({ zone: z.id, m })))
    if (pages.length > 60) throw new HttpError(400, 'too many pages to check at once; check one zone at a time')
    const results: ApiProbeResult[] = []
    const queue = [...pages]
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const r = await checkPage(p.m, draft.probe.timeoutMs)
          results.push({ zone: p.zone, id: p.m.id, url: p.m.url, ok: r.ok, latency: r.latency, code: r.code, error: r.error })
        }
      })
    )
    const order = pages.map((p) => `${p.zone}/${p.m.id}`)
    results.sort((a, b) => order.indexOf(`${a.zone}/${a.id}`) - order.indexOf(`${b.zone}/${b.id}`))
    return json(results)
  }
  if (method === 'POST' && route === 'events') return json(await createEvent(env, config, body as EventInput, now), 201)
  if (parts[2] === 'events' && id) {
    if (method === 'PATCH' && parts.length === 4) return json(await editEvent(env, config, id, body as Partial<EventInput>, now))
    if (method === 'DELETE' && parts.length === 4) {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM event_updates WHERE event_id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id),
      ])
      return json({ ok: true })
    }
    if (method === 'POST' && parts[4] === 'updates') return json(await addUpdate(env, config, id, body as never, now), 201)
  }
  if (method === 'POST' && route === 'subscribers') {
    // Admin-added subscribers (e.g. a partner team's chat channel) skip confirmation.
    const input = validateSubscription(body as never, { ...config, email: config.email ?? { apiKey: '', from: '' } })
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')
    await env.DB.prepare(
      `INSERT INTO subscribers (kind, target, zones, auto, lang, token, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (kind, target) DO UPDATE SET zones = excluded.zones, auto = excluded.auto, lang = excluded.lang, verified = 1`
    )
      .bind(input.kind, input.target, input.zones ? JSON.stringify(input.zones) : null, input.auto ? 1 : 0, input.lang, token, now)
      .run()
    return json({ ok: true }, 201)
  }
  if (method === 'DELETE' && parts[2] === 'subscribers' && id) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM outbox WHERE subscriber_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM subscribers WHERE id = ?`).bind(id),
    ])
    return json({ ok: true })
  }
  if (method === 'POST' && route === 'test-notification') {
    // Without a URL this tests the team webhook; with one, any URL (optionally forcing the format).
    const { url: target, flavor, secret } = (body ?? {}) as { url?: string; flavor?: WebhookFlavor; secret?: string }
    const notice: Notice = { type: 'test', at: now }
    const error = target
      ? await sendWebhook(target, notice, config.language, config, secret ?? null, flavor ?? webhookFlavor(target))
      : config.team
        ? await notifyTeam(config, notice)
        : 'no team webhook configured'
    return json({ ok: !error, error })
  }
  if (method === 'POST' && route === 'outbox/retry') {
    await env.DB.prepare(`UPDATE outbox SET status = 'pending', attempts = 0, next_at = ? WHERE status = 'failed'`).bind(now).run()
    await drainOutbox(env, config, now)
    return json({ ok: true })
  }
  throw new HttpError(404, 'not found')
}
