// Notifications: the team channel, and subscribers (email via Resend, chat webhooks).
// Subscriber messages go through the `outbox` table and are delivered with retries.
import { OUTBOX_BATCH, USER_AGENT } from '../status.config'
import { IMPACT_LABEL, STATUS_LABEL, type Lang } from '../shared/labels'
import type { EventKind, EventStatus, Impact, Localized } from '../shared/types'
import type { ResolvedConfig } from './config'
import type { Env } from './env'

export interface NoticeOutage {
  kind: 'down' | 'up'
  zone: string
  zoneName: Localized
  monitorName: Localized
  url: string
  since: number
  minutes: number
  error: string
}

export interface NoticeEvent {
  id: number
  kind: EventKind
  title: string
  impact: Impact
  status: EventStatus
  body: string
  /** Display names of the affected zones/pages; empty = every zone. */
  components: Localized[]
  startsAt: number
  endsAt: number | null
}

export type Notice =
  | { type: 'event'; at: number; first: boolean; event: NoticeEvent }
  | { type: 'outages'; at: number; items: NoticeOutage[] }
  | { type: 'test'; at: number }

type Color = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'grey'

interface Rendered {
  title: string
  /** Light Markdown (bold only), also readable as plain text. */
  body: string
  color: Color
  url: string | null
}

const L = (text: Localized, lang: Lang) => (typeof text === 'string' ? text : text[lang])

function formatTime(ts: number, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-CN', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts * 1000))
}

function duration(minutes: number, lang: Lang): string {
  const m = Math.max(1, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (lang === 'en') return m < 60 ? `${m} min` : r ? `${h} h ${r} min` : `${h} h`
  return m < 60 ? `${m} 分钟` : r ? `${h} 小时 ${r} 分钟` : `${h} 小时`
}

const IMPACT_COLOR: Record<Impact, Color> = { degraded: 'yellow', partial: 'orange', major: 'red', maintenance: 'blue' }

export function render(notice: Notice, lang: Lang, config: ResolvedConfig): Rendered {
  const tz = config.site.timezone
  const site = L(config.site.title, lang)
  if (notice.type === 'test') {
    return {
      title: lang === 'en' ? `${site}: test notification` : `${site}：测试通知`,
      body: lang === 'en' ? 'This channel works. Incident and maintenance updates will be posted here.' : '通知通道工作正常，之后的故障与维护消息会发到这里。',
      color: 'blue',
      url: config.siteUrl,
    }
  }
  if (notice.type === 'outages') {
    const down = notice.items.filter((i) => i.kind === 'down')
    const lines = notice.items.map((i) => {
      const name = `${L(i.zoneName, lang)} · ${L(i.monitorName, lang)}`
      if (i.kind === 'down') {
        return lang === 'en'
          ? `🔴 **${name}** is down since ${formatTime(i.since, tz, lang)} (${duration(i.minutes, lang)})\n${i.url}\nError: ${i.error}`
          : `🔴 **${name}** 不可用，自 ${formatTime(i.since, tz, lang)} 起已持续 ${duration(i.minutes, lang)}\n${i.url}\n原因：${i.error}`
      }
      return lang === 'en' ? `✅ **${name}** recovered after ${duration(i.minutes, lang)}` : `✅ **${name}** 已恢复，故障持续 ${duration(i.minutes, lang)}`
    })
    const title =
      down.length > 0
        ? lang === 'en'
          ? `${site}: ${down.length} page${down.length === 1 ? '' : 's'} down`
          : `${site}：检测到 ${down.length} 个页面不可用`
        : lang === 'en'
          ? `${site}: pages recovered`
          : `${site}：页面已恢复`
    return { title, body: lines.join('\n\n'), color: down.length > 0 ? 'red' : 'green', url: config.siteUrl }
  }

  const e = notice.event
  const status = STATUS_LABEL[e.status][lang]
  const impact = IMPACT_LABEL[e.impact][lang]
  const en = lang === 'en'
  const scope = e.components.length ? e.components.map((c) => L(c, lang)).join(en ? ', ' : '、') : en ? 'All zones' : '全部可用区'
  const kindLabel = e.kind === 'maintenance' ? (en ? 'Maintenance' : '维护') : en ? 'Incident' : '事件'
  const window =
    e.kind === 'maintenance'
      ? `\n${en ? 'Window: ' : '时间：'}${formatTime(e.startsAt, tz, lang)}${e.endsAt ? ` → ${formatTime(e.endsAt, tz, lang)}` : ''}`
      : ''
  const done = e.status === 'resolved' || e.status === 'completed'
  return {
    title: `[${kindLabel}${en ? ' · ' : '·'}${status}] ${e.title}`,
    body: `**${impact}** · ${scope}${window}\n\n${e.body}`,
    color: done ? 'green' : IMPACT_COLOR[e.impact],
    url: config.siteUrl ? `${config.siteUrl}/incidents/${e.id}` : null,
  }
}

// ---- Transports ----

function feishuCard(r: Rendered, lang: Lang) {
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { template: r.color, title: { tag: 'plain_text', content: r.title } },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: r.body.slice(0, 4000) } },
        ...(r.url
          ? [
              {
                tag: 'action',
                actions: [
                  { tag: 'button', type: 'primary', text: { tag: 'plain_text', content: lang === 'en' ? 'Open status page' : '查看状态页' }, url: r.url },
                ],
              },
            ]
          : []),
      ],
    },
  }
}

async function feishuSign(secret: string, timestamp: number): Promise<string> {
  // Feishu: HMAC-SHA256 keyed with "timestamp\nsecret" over an empty message, base64.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${timestamp}\n${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array()))
  return btoa(String.fromCharCode(...sig))
}

/** Chat platform of a webhook URL; anything else receives generic JSON. */
export type WebhookFlavor = 'feishu' | 'dingtalk' | 'wecom' | 'slack' | 'discord' | 'json'

export function webhookFlavor(url: string): WebhookFlavor {
  const host = new URL(url).host
  if (/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(host)) return 'feishu'
  if (host === 'oapi.dingtalk.com') return 'dingtalk'
  if (host === 'qyapi.weixin.qq.com') return 'wecom'
  if (host === 'hooks.slack.com') return 'slack'
  if (/(^|\.)discord(app)?\.com$/.test(host)) return 'discord'
  return 'json'
}

const plain = (r: Rendered) => `${r.title}\n\n${r.body.replaceAll('**', '')}${r.url ? `\n\n${r.url}` : ''}`

async function postJson(url: string, payload: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    if (!res.ok) return `HTTP ${res.status}: ${text.slice(0, 200)}`
    // Feishu, DingTalk and WeCom answer 200 with an error code in the body.
    try {
      const data = JSON.parse(text) as { code?: number; errcode?: number; msg?: string; errmsg?: string }
      const code = data.code ?? data.errcode
      if (code !== undefined && code !== 0) return `code ${code}: ${data.msg ?? data.errmsg ?? text.slice(0, 200)}`
    } catch {
      // Non-JSON 2xx bodies (Slack answers "ok") are success.
    }
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export async function sendWebhook(
  url: string,
  notice: Notice,
  lang: Lang,
  config: ResolvedConfig,
  secret?: string | null,
  flavor = webhookFlavor(url)
): Promise<string | null> {
  const r = render(notice, lang, config)
  switch (flavor) {
    case 'feishu': {
      const payload: Record<string, unknown> = feishuCard(r, lang)
      if (secret) {
        const timestamp = Math.floor(Date.now() / 1000)
        payload.timestamp = String(timestamp)
        payload.sign = await feishuSign(secret, timestamp)
      }
      return postJson(url, payload)
    }
    case 'dingtalk':
      return postJson(url, { msgtype: 'markdown', markdown: { title: r.title, text: `### ${r.title}\n\n${r.body}${r.url ? `\n\n[${r.url}](${r.url})` : ''}` } })
    case 'wecom':
      return postJson(url, { msgtype: 'markdown', markdown: { content: `### ${r.title}\n${r.body}${r.url ? `\n[${r.url}](${r.url})` : ''}` } })
    case 'slack':
      return postJson(url, { text: plain(r) })
    case 'discord':
      return postJson(url, { content: plain(r).slice(0, 1900) })
    default:
      return postJson(url, { title: r.title, text: plain(r), url: r.url, notice })
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const EMAIL_COLOR: Record<Color, string> = { red: '#f87171', orange: '#f5785c', yellow: '#fbbf24', green: '#24c19a', blue: '#3b82f6', grey: '#95959d' }

export function emailHtml(r: Rendered, lang: Lang, footerLink: { url: string; label: string } | null, buttonLabel?: string): string {
  const body = escapeHtml(r.body)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
  return `<!doctype html><html><body style="margin:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#161618">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e4e4e7;border-radius:8px">
<tr><td style="height:4px;background:${EMAIL_COLOR[r.color]};border-radius:8px 8px 0 0"></td></tr>
<tr><td style="padding:24px 28px 8px;font-size:17px;font-weight:600">${escapeHtml(r.title)}</td></tr>
<tr><td style="padding:8px 28px 24px;font-size:14px;line-height:22px">${body}</td></tr>
${r.url ? `<tr><td style="padding:0 28px 28px"><a href="${escapeHtml(r.url)}" style="display:inline-block;background:#29292f;color:#fff;text-decoration:none;font-size:14px;padding:8px 14px;border-radius:6px">${escapeHtml(buttonLabel ?? (lang === 'en' ? 'View status page' : '查看状态页'))}</a></td></tr>` : ''}
</table>
${footerLink ? `<p style="font-size:12px;color:#95959d;margin-top:16px"><a href="${escapeHtml(footerLink.url)}" style="color:#95959d">${escapeHtml(footerLink.label)}</a></p>` : ''}
</td></tr></table></body></html>`
}

export async function sendEmail(config: ResolvedConfig, to: string, subject: string, html: string, unsubscribeUrl?: string): Promise<string | null> {
  if (!config.email) return 'email is not configured'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.email.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.email.from,
        to: [to],
        subject,
        html,
        ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`
  } catch (e) {
    return (e as Error).message
  }
}

/** Team channel: every notice goes straight to the team webhook, in the site's language. */
export async function notifyTeam(config: ResolvedConfig, notice: Notice): Promise<string | null> {
  if (!config.team) return null
  const error = await sendWebhook(config.team.url, notice, config.language, config, config.team.secret)
  if (error) console.error('team notification failed:', error)
  return error
}

// ---- Subscriber outbox ----

/**
 * Queues a notice for every verified subscriber of the given zones (null = all zones).
 * `auto` notices (automatic detections) only go to subscribers that opted into them.
 */
export function enqueueStatement(env: Env, notice: Notice, zones: string[] | null, auto: boolean, now: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO outbox (subscriber_id, notice, next_at, created_at)
     SELECT id, ?1, ?4, ?4 FROM subscribers
     WHERE verified = 1
       AND (?2 IS NULL OR zones IS NULL OR EXISTS (
         SELECT 1 FROM json_each(subscribers.zones) z WHERE z.value IN (SELECT value FROM json_each(?2))))
       AND (?3 = 0 OR auto = 1)`
  ).bind(JSON.stringify(notice), zones ? JSON.stringify(zones) : null, auto ? 1 : 0, now)
}

const RETRY_MINUTES = [1, 5, 30, 120]

export function unsubscribeUrl(config: ResolvedConfig, token: string): string | null {
  return config.siteUrl ? `${config.siteUrl}/unsubscribe?token=${token}` : null
}

export async function deliver(
  config: ResolvedConfig,
  sub: { kind: string; target: string; lang: Lang; token: string },
  notice: Notice
): Promise<string | null> {
  if (sub.kind === 'webhook') return sendWebhook(sub.target, notice, sub.lang, config)
  const r = render(notice, sub.lang, config)
  const unsub = unsubscribeUrl(config, sub.token)
  const html = emailHtml(r, sub.lang, unsub ? { url: unsub, label: sub.lang === 'en' ? 'Unsubscribe' : '退订通知' } : null)
  return sendEmail(config, sub.target, r.title, html, unsub ?? undefined)
}

export async function drainOutbox(env: Env, config: ResolvedConfig, now: number): Promise<void> {
  // Rows left "sending" by an invocation that died are retried.
  await env.DB.prepare(`UPDATE outbox SET status = 'pending' WHERE status = 'sending' AND next_at < ?`).bind(now - 600).run()
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.notice, o.attempts, s.id AS sid, s.kind, s.target, s.lang, s.token
     FROM outbox o JOIN subscribers s ON s.id = o.subscriber_id
     WHERE o.status = 'pending' AND o.next_at <= ? ORDER BY o.id LIMIT ?`
  )
    .bind(now, OUTBOX_BATCH)
    .all<{ id: number; notice: string; attempts: number; sid: number; kind: string; target: string; lang: Lang; token: string }>()
  if (results.length === 0) return
  await env.DB.prepare(`UPDATE outbox SET status = 'sending', next_at = ? WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(now, JSON.stringify(results.map((r) => r.id)))
    .run()

  const writes: D1PreparedStatement[] = []
  const queue = [...results]
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const error = await deliver(config, row, JSON.parse(row.notice) as Notice)
        if (!error) {
          writes.push(env.DB.prepare(`UPDATE outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?`).bind(now, row.id))
          writes.push(env.DB.prepare(`UPDATE subscribers SET last_error = NULL WHERE id = ? AND last_error IS NOT NULL`).bind(row.sid))
        } else {
          const attempts = row.attempts + 1
          const giveUp = attempts > RETRY_MINUTES.length
          writes.push(
            env.DB.prepare(`UPDATE outbox SET status = ?, attempts = ?, next_at = ?, last_error = ? WHERE id = ?`).bind(
              giveUp ? 'failed' : 'pending',
              attempts,
              now + (RETRY_MINUTES[attempts - 1] ?? 0) * 60,
              error.slice(0, 500),
              row.id
            )
          )
          writes.push(env.DB.prepare(`UPDATE subscribers SET last_error = ? WHERE id = ?`).bind(error.slice(0, 500), row.sid))
        }
      }
    })
  )
  await env.DB.batch(writes)
}
