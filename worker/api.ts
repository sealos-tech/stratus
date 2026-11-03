// Public read API and subscription endpoints.
import { STALE_SECONDS } from '../status.config'
import type { Lang } from '../shared/labels'
import { dayRange, dayStart, localParts } from '../shared/time'
import {
  CODE_STATUS,
  type ApiDayStats,
  type ApiEventDetail,
  type ApiHistory,
  type ApiMonitor,
  type ApiMonitorDay,
  type ApiMonitorDetail,
  type ApiSummary,
  type ApiZone,
  type ComponentRef,
  type DayCounts,
  type Status,
  type SubscribeRequest,
  type ZoneConfig,
} from '../shared/types'
import { getConfig, zoneIndex, type ResolvedConfig } from './config'
import type { Env } from './env'
import { covers, getEvent, isActive, listEvents, toOutage, type OutageRow } from './events'
import { emailHtml, render, sendEmail, sendWebhook, unsubscribeUrl, webhookFlavor } from './notify'
import { HttpError, json, sha256 } from './http'
import { key, loadState, type State } from './state'

export { HttpError, json }

function buildZone(zone: ZoneConfig, state: State, days: string[], now: number, maintenance: ComponentRef[][]): ApiZone {
  return {
    id: zone.id,
    domain: zone.domain,
    name: zone.name,
    location: zone.location,
    country: zone.country,
    colo: state.colo[zone.id] ?? null,
    monitors: zone.monitors.map((m): ApiMonitor => {
      const k = key(zone.id, m.id)
      const latest = state.latest[k]
      const fresh = latest && now - latest.ts <= STALE_SECONDS
      let status: Status = fresh ? CODE_STATUS[latest.s] : 'nodata'
      if (status === 'nodata' && maintenance.some((c) => covers(c, zone.id, m.id))) status = 'maintenance'
      const perDay = state.days[k] ?? {}
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        url: m.url,
        status,
        lastTs: latest?.ts ?? null,
        latency: latest?.lat ?? null,
        code: latest?.code ?? null,
        error: latest?.err ?? null,
        colo: latest?.colo ?? null,
        days: days.map((d): DayCounts => {
          const t = perDay[d]
          return t ? [t[0], t[1], t[2], t[3], t[5] ? Math.round(t[4] / t[5]) : 0] : [0, 0, 0, 0, 0]
        }),
      }
    }),
  }
}

function window(config: ResolvedConfig, now: number) {
  const days = dayRange(localParts(now, config.site.timezone).day, config.site.historyDays)
  return { days, from: dayStart(days[0], config.site.timezone) }
}

async function summary(env: Env, config: ResolvedConfig, now: number): Promise<ApiSummary> {
  const { days, from } = window(config, now)
  const [state, outages, events] = await Promise.all([
    loadState(env, config, now),
    env.DB.prepare(`SELECT id, zone, monitor, start_ts, end_ts, error, errors, notified FROM outages WHERE end_ts IS NULL`)
      .all<OutageRow>()
      .then((r) => r.results),
    listEvents(env, from, now + 1, now),
  ])
  const maintenance = events.filter((e) => e.kind === 'maintenance' && e.status === 'in_progress').map((e) => e.components)
  const configured = new Set(config.zones.flatMap((z) => z.monitors.map((m) => key(z.id, m.id))))
  return {
    site: config.site,
    generatedAt: now,
    days,
    zones: config.zones.map((z) => buildZone(z, state, days, now, maintenance)),
    ongoingOutages: outages.filter((o) => configured.has(key(o.zone, o.monitor))).map(toOutage),
    events,
    subscribe: { email: !!config.email, webhook: true },
  }
}

async function monitorDetail(env: Env, config: ResolvedConfig, zoneId: string, monitorId: string, now: number): Promise<ApiMonitorDetail> {
  const zoneConfig = config.zones.find((z) => z.id === zoneId)
  const monitorConfig = zoneConfig?.monitors.find((m) => m.id === monitorId)
  if (!zoneConfig || !monitorConfig) throw new HttpError(404, 'not found')
  const { days, from } = window(config, now)
  const [state, rows, outages, events] = await Promise.all([
    loadState(env, config, now),
    env.DB.prepare(
      `SELECT day, up, degraded, down, maintenance, latency_sum, latency_count, latency_min, latency_max
       FROM daily WHERE zone = ? AND monitor = ? AND day >= ?`
    )
      .bind(zoneId, monitorId, days[0])
      .all<{ day: string; up: number; degraded: number; down: number; maintenance: number; latency_sum: number; latency_count: number; latency_min: number | null; latency_max: number | null }>()
      .then((r) => r.results),
    env.DB.prepare(
      `SELECT id, zone, monitor, start_ts, end_ts, error, errors, notified FROM outages
       WHERE zone = ? AND monitor = ? AND (end_ts IS NULL OR end_ts >= ?) ORDER BY start_ts DESC LIMIT 100`
    )
      .bind(zoneId, monitorId, from)
      .all<OutageRow>()
      .then((r) => r.results.map(toOutage)),
    listEvents(env, from, now + 1, now),
  ])
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const relevant = events.filter((e) => covers(e.components, zoneId, monitorId))
  const maintenance = relevant.filter((e) => e.kind === 'maintenance' && e.status === 'in_progress').map((e) => e.components)
  const zone = buildZone({ ...zoneConfig, monitors: [monitorConfig] }, state, days, now, maintenance)
  return {
    zone: { ...zone, monitors: [] },
    monitor: zone.monitors[0],
    days,
    history: days.map((day): ApiDayStats => {
      const r = byDay.get(day)
      return {
        day,
        up: r?.up ?? 0,
        degraded: r?.degraded ?? 0,
        down: r?.down ?? 0,
        maintenance: r?.maintenance ?? 0,
        avg: r?.latency_count ? Math.round(r.latency_sum / r.latency_count) : 0,
        min: r?.latency_min ?? 0,
        max: r?.latency_max ?? 0,
      }
    }),
    outages,
    events: relevant,
    timezone: config.site.timezone,
  }
}

async function monitorDay(env: Env, config: ResolvedConfig, zoneId: string, monitorId: string, day: string): Promise<ApiMonitorDay> {
  if (!config.zones.find((z) => z.id === zoneId)?.monitors.some((m) => m.id === monitorId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new HttpError(404, 'not found')
  }
  const start = dayStart(day, config.site.timezone)
  const [row, outages] = await Promise.all([
    env.DB.prepare(`SELECT minutes, latencies FROM daily WHERE zone = ? AND monitor = ? AND day = ?`)
      .bind(zoneId, monitorId, day)
      .first<{ minutes: string; latencies: string }>(),
    env.DB.prepare(
      `SELECT id, zone, monitor, start_ts, end_ts, error, errors, notified FROM outages
       WHERE zone = ? AND monitor = ? AND start_ts < ? AND (end_ts IS NULL OR end_ts >= ?) ORDER BY start_ts`
    )
      .bind(zoneId, monitorId, start + 86400, start)
      .all<OutageRow>()
      .then((r) => r.results.map(toOutage)),
  ])
  const latencies = new Array<number>(1440).fill(0)
  const minutes = row?.minutes || '.'.repeat(1440)
  if (row?.latencies) for (let i = 0; i < 1440; i++) latencies[i] = parseInt(row.latencies.slice(i * 4, i * 4 + 4), 16)
  return { day, dayStart: start, minutes, latencies, outages }
}

async function history(env: Env, config: ResolvedConfig, url: URL, now: number): Promise<ApiHistory> {
  const to = Number(url.searchParams.get('to')) || now + 1
  const from = Number(url.searchParams.get('from')) || to - 90 * 86400
  const [events, outages] = await Promise.all([
    listEvents(env, from, to, now),
    env.DB.prepare(
      `SELECT id, zone, monitor, start_ts, end_ts, error, errors, notified FROM outages
       WHERE start_ts < ? AND (end_ts IS NULL OR end_ts >= ?) AND (notified = 1 OR end_ts IS NULL)
       ORDER BY start_ts DESC LIMIT 500`
    )
      .bind(to, from)
      .all<OutageRow>()
      .then((r) => r.results.map(toOutage)),
  ])
  return {
    from,
    to,
    timezone: config.site.timezone,
    zones: zoneIndex(config),
    events: events.filter((e) => e.startsAt < to && (e.endsAt === null || e.endsAt >= from || isActive(e))),
    outages,
  }
}

// ---- Subscriptions ----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function validateSubscription(body: SubscribeRequest, config: ResolvedConfig): SubscribeRequest {
  const kind = body.kind
  const target = String(body.target ?? '').trim()
  if (kind !== 'email' && kind !== 'webhook') throw new HttpError(400, 'kind must be email or webhook')
  if (kind === 'email') {
    if (!config.email) throw new HttpError(400, 'email subscriptions are not enabled')
    if (!EMAIL_RE.test(target) || target.length > 254) throw new HttpError(400, 'invalid email address')
  } else {
    let u: URL
    try {
      u = new URL(target)
    } catch {
      throw new HttpError(400, 'invalid webhook URL')
    }
    const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new HttpError(400, 'webhook URL must use https')
  }
  const zoneIds = new Set(config.zones.map((z) => z.id))
  const zones = Array.isArray(body.zones) && body.zones.length > 0 ? body.zones.filter((z) => zoneIds.has(z)) : null
  return { kind, target: kind === 'email' ? target.toLowerCase() : target, zones: zones?.length ? zones : null, auto: body.auto !== false, lang: body.lang === 'zh' ? 'zh' : 'en' }
}

async function subscribe(request: Request, env: Env, config: ResolvedConfig, now: number): Promise<Response> {
  const input = validateSubscription((await request.json()) as SubscribeRequest, config)
  const ipHash = await sha256(`${request.headers.get('cf-connecting-ip') ?? 'local'}:sealos-status`)
  const recent = await env.DB.prepare(`SELECT count(*) AS n FROM subscribers WHERE ip_hash = ? AND created_at > ?`)
    .bind(ipHash, now - 3600)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= 10) throw new HttpError(429, 'too many subscriptions, try again later')

  const existing = await env.DB.prepare(`SELECT id, token, verified FROM subscribers WHERE kind = ? AND target = ?`)
    .bind(input.kind, input.target)
    .first<{ id: number; token: string; verified: number }>()
  const token = existing?.token ?? randomToken()
  const zones = input.zones ? JSON.stringify(input.zones) : null

  if (input.kind === 'webhook') {
    // A webhook is confirmed by delivering a test message to it.
    const error = await sendWebhook(input.target, { type: 'test', at: now }, input.lang, config)
    if (error) throw new HttpError(400, `could not deliver a test message to the webhook: ${error}`)
  }
  const verified = input.kind === 'webhook' ? 1 : (existing?.verified ?? 0)
  await env.DB.prepare(
    `INSERT INTO subscribers (kind, target, zones, auto, lang, token, verified, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, target) DO UPDATE SET zones = excluded.zones, auto = excluded.auto, lang = excluded.lang,
       verified = max(verified, excluded.verified)`
  )
    .bind(input.kind, input.target, zones, input.auto ? 1 : 0, input.lang, token, verified, ipHash, now)
    .run()

  if (input.kind === 'email' && !verified) {
    const base = config.siteUrl ?? new URL(request.url).origin
    const confirm = `${base}/api/subscribe/confirm?token=${token}`
    const en = input.lang === 'en'
    const site = typeof config.site.title === 'string' ? config.site.title : config.site.title[input.lang]
    const r = {
      title: en ? `Confirm your ${site} subscription` : `请确认订阅「${site}」通知`,
      body: en ? 'Click the button below to confirm. If you did not ask for this, ignore this email.' : '点击下方按钮确认订阅。如果不是你本人操作，忽略这封邮件即可。',
      color: 'blue' as const,
      url: confirm,
    }
    const error = await sendEmail(config, input.target, r.title, emailHtml(r, input.lang, null, en ? 'Confirm subscription' : '确认订阅'))
    if (error) throw new HttpError(502, `could not send the confirmation email: ${error}`)
  }
  return json({ ok: true, kind: input.kind, verified: verified === 1, flavor: input.kind === 'webhook' ? webhookFlavor(input.target) : null })
}

const PAGES = {
  subscribed: {
    en: ['Subscribed', 'You will now receive incident and maintenance updates.'],
    zh: ['订阅成功', '之后的故障与维护消息会发送到你的邮箱。'],
  },
  unsubscribed: {
    en: ['Unsubscribed', 'You will no longer receive status notifications.'],
    zh: ['已退订', '你不会再收到状态通知。'],
  },
  invalid: {
    en: ['Invalid link', 'This link is no longer valid.'],
    zh: ['链接无效', '这个链接已失效。'],
  },
} as const

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Small result page for the links in subscription emails, in the subscriber's language. */
function page(kind: keyof typeof PAGES, lang: Lang, config: ResolvedConfig): Response {
  const [title, message] = PAGES[kind][lang]
  const site = escape(typeof config.site.title === 'string' ? config.site.title : config.site.title[lang])
  return new Response(
    `<!doctype html><html lang="${lang === 'en' ? 'en' : 'zh-CN'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:grid;place-items:center;min-height:90vh;color:#161618">
<div style="max-width:420px;text-align:center"><h1 style="font-size:20px;font-weight:600">${title}</h1><p style="color:#78788c">${message}</p><p><a href="/" style="color:#161618">← ${site}</a></p></div>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}

async function confirm(env: Env, config: ResolvedConfig, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? ''
  const row = await env.DB.prepare(`UPDATE subscribers SET verified = 1 WHERE token = ? RETURNING lang`).bind(token).first<{ lang: Lang }>()
  return page(row ? 'subscribed' : 'invalid', row?.lang ?? config.language, config)
}

async function unsubscribe(env: Env, config: ResolvedConfig, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? ''
  const row = await env.DB.prepare(`DELETE FROM subscribers WHERE token = ? RETURNING lang`).bind(token).first<{ lang: Lang }>()
  if (row) await env.DB.prepare(`DELETE FROM outbox WHERE subscriber_id NOT IN (SELECT id FROM subscribers)`).run()
  return page(row ? 'unsubscribed' : 'invalid', row?.lang ?? config.language, config)
}

// ---- Router ----

/**
 * GET responses are cached at the edge (API_CACHE_SECONDS, default 30), so a traffic spike
 * during an outage does not hit D1.
 */
export async function handlePublic(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const config = await getConfig(env)
  const now = Math.floor(Date.now() / 1000)
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (request.method === 'POST' && url.pathname === '/api/subscribe') return subscribe(request, env, config, now)
  if (url.pathname === '/api/subscribe/confirm') return confirm(env, config, url)
  if (url.pathname === '/unsubscribe' || url.pathname === '/api/unsubscribe') return unsubscribe(env, config, url)
  if (request.method !== 'GET') throw new HttpError(405, 'method not allowed')

  const maxAge = env.API_CACHE_SECONDS === undefined ? 30 : Number(env.API_CACHE_SECONDS)
  const cache = (caches as unknown as { default: Cache }).default
  if (maxAge > 0) {
    const cached = await cache.match(request)
    if (cached) return cached
  }

  let data: unknown
  if (parts[1] === 'summary' && parts.length === 2) data = await summary(env, config, now)
  else if (parts[1] === 'history' && parts.length === 2) data = await history(env, config, url, now)
  else if (parts[1] === 'events' && parts.length === 3) {
    const event = await getEvent(env, Number(parts[2]), now)
    if (!event) throw new HttpError(404, 'not found')
    data = { event, zones: zoneIndex(config), timezone: config.site.timezone } satisfies ApiEventDetail
  } else if (parts[1] === 'monitors' && parts.length === 4) data = await monitorDetail(env, config, parts[2], parts[3], now)
  else if (parts[1] === 'monitors' && parts.length === 6 && parts[4] === 'days') data = await monitorDay(env, config, parts[2], parts[3], parts[5])
  else throw new HttpError(404, 'not found')

  const response = json(data, 200, maxAge)
  if (maxAge > 0) ctx.waitUntil(cache.put(request, response.clone()))
  return response
}

export { render, unsubscribeUrl }
