// Runtime configuration: admin-edited settings from D1 (kv row "settings") over the built-in
// defaults in status.config.ts.
import { DEFAULT_SETTINGS, HISTORY_DAYS, LIMITS } from '../status.config'
import {
  REGIONS,
  SECRET_FIELDS,
  fillDomain,
  type AdminSettings,
  type SecretField,
  type Settings,
  type SettingsInput,
  type Text,
  type ZoneSetting,
} from '../shared/settings'
import type { MonitorConfig, SiteConfig, ZoneConfig, ZoneIndex } from '../shared/types'
import type { Env } from './env'
import { HttpError } from './http'

export interface ResolvedConfig {
  zones: ZoneConfig[]
  site: SiteConfig
  siteUrl: string | null
  graceMinutes: number
  probe: { timeoutMs: number; degradedMs: number }
  team: { url: string; secret: string | null } | null
  language: 'en' | 'zh'
  email: { apiKey: string; from: string } | null
}

export function zoneMonitors(zone: ZoneSetting, apps: Settings['apps']): MonitorConfig[] {
  return [
    ...apps.filter((a) => !zone.exclude.includes(a.id)).map((a) => ({ id: a.id, name: a.name, url: fillDomain(a.url, zone.domain) })),
    ...zone.extra.map((p) => ({ id: p.id, name: p.name, url: p.url, ...(p.keyword ? { keyword: p.keyword } : {}) })),
  ]
}

export function resolve(settings: Settings): ResolvedConfig {
  return {
    zones: settings.zones.map((z) => ({
      id: z.id,
      domain: z.domain,
      name: z.name,
      location: z.location,
      country: z.country,
      probe: z.probe,
      monitors: zoneMonitors(z, settings.apps),
    })),
    site: { title: settings.site.title, timezone: settings.site.timezone, historyDays: HISTORY_DAYS, language: settings.site.language },
    siteUrl: settings.site.url || null,
    graceMinutes: settings.notify.graceMinutes,
    probe: settings.probe,
    team: settings.notify.webhookUrl ? { url: settings.notify.webhookUrl, secret: settings.notify.webhookSecret || null } : null,
    language: settings.site.language,
    email: settings.email.resendApiKey && settings.email.from ? { apiKey: settings.email.resendApiKey, from: settings.email.from } : null,
  }
}

// Settings change rarely and every request needs them: keep the last read for a few seconds per
// isolate. A save clears the cache of the isolate that handled it; others pick it up within TTL.
const TTL_MS = 10_000
let cache: { at: number; settings: Settings } | undefined

export async function loadSettings(env: Env): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.settings
  const row = await env.DB.prepare(`SELECT value FROM kv WHERE key = 'settings'`).first<{ value: string }>()
  const stored = row ? (JSON.parse(row.value) as Partial<Settings>) : {}
  // Groups saved by an older version may lack newer fields: fill them from the defaults.
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    site: { ...DEFAULT_SETTINGS.site, ...stored.site },
    notify: { ...DEFAULT_SETTINGS.notify, ...stored.notify },
    email: { ...DEFAULT_SETTINGS.email, ...stored.email },
    probe: { ...DEFAULT_SETTINGS.probe, ...stored.probe },
  }
  cache = { at: Date.now(), settings }
  return settings
}

export async function getConfig(env: Env): Promise<ResolvedConfig> {
  return resolve(await loadSettings(env))
}

export function zoneIndex(config: ResolvedConfig): ZoneIndex[] {
  return config.zones.map((z) => ({
    id: z.id,
    name: z.name,
    domain: z.domain,
    monitors: z.monitors.map((m) => ({ id: m.id, name: m.name })),
  }))
}

// ---- Admin view and validation ----

function getSecret(s: Settings, field: SecretField): string {
  const [group, key] = field.split('.') as [keyof Settings, string]
  return (s[group] as unknown as Record<string, string>)[key]
}

function mask(value: string): string | null {
  if (!value) return null
  if (value.startsWith('http')) {
    try {
      const u = new URL(value)
      return `${u.host}/…${value.slice(-4)}`
    } catch {
      // fall through
    }
  }
  return `…${value.slice(-4)}`
}

export function adminView(settings: Settings): AdminSettings {
  const secrets = Object.fromEntries(SECRET_FIELDS.map((f) => [f, mask(getSecret(settings, f))])) as AdminSettings['secrets']
  return {
    settings: {
      ...settings,
      notify: { ...settings.notify, webhookUrl: '', webhookSecret: '' },
      email: { ...settings.email, resendApiKey: '' },
    },
    secrets,
    regions: REGIONS,
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/

function text(value: unknown, field: string, required = true): Text {
  const v = (value ?? {}) as Partial<Text>
  const zh = String(v.zh ?? '').trim().slice(0, 100)
  const en = String(v.en ?? '').trim().slice(0, 100)
  if (required && !zh && !en) throw new HttpError(400, `${field}: name is required`)
  // One language may be left empty; it falls back to the other.
  return { zh: zh || en, en: en || zh }
}

function httpUrl(value: unknown, field: string, { template = false, allowEmpty = false } = {}): string {
  const v = String(value ?? '').trim()
  if (!v && allowEmpty) return ''
  try {
    const u = new URL(template ? fillDomain(v, 'example.com') : v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
  } catch {
    throw new HttpError(400, `${field}: "${v}" is not a valid http(s) URL`)
  }
  return v
}

function timeZone(value: unknown): string {
  const v = String(value ?? '').trim() || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
  } catch {
    throw new HttpError(400, `time zone: "${v}" is not an IANA time zone such as UTC or America/Los_Angeles`)
  }
  return v
}

function int(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field}: must be a whole number between ${min} and ${max}`)
  return n
}

function uniqueIds<T extends { id: string }>(list: T[], field: string) {
  const seen = new Set<string>()
  for (const item of list) {
    if (!ID_RE.test(item.id)) throw new HttpError(400, `${field}: id "${item.id}" may only use a-z, 0-9 and "-"`)
    if (seen.has(item.id)) throw new HttpError(400, `${field}: duplicate id "${item.id}"`)
    seen.add(item.id)
  }
}

/** Validates admin input; secret fields sent as null keep their stored value. */
export function validateSettings(input: SettingsInput, current: Settings): Settings {
  const apps = (Array.isArray(input.apps) ? input.apps : []).map((a, i) => ({
    id: String(a.id ?? '').trim(),
    name: text(a.name, `standard page ${i + 1}`),
    url: httpUrl(a.url, `standard page "${a.id}"`, { template: true }),
  }))
  uniqueIds(apps, 'standard pages')

  const regions = new Set(REGIONS.map((r) => r.id))
  const appIds = new Set(apps.map((a) => a.id))
  const zones = (Array.isArray(input.zones) ? input.zones : []).map((z, i): ZoneSetting => {
    const domain = String(z.domain ?? '').trim().toLowerCase()
    if (!DOMAIN_RE.test(domain)) throw new HttpError(400, `zone ${i + 1}: "${domain}" is not a valid domain`)
    if (!regions.has(z.probe)) throw new HttpError(400, `zone ${domain}: unknown probe region "${z.probe}"`)
    const country = String(z.country ?? '').trim().toUpperCase()
    if (country && !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, `zone ${domain}: country must be a 2-letter code`)
    const extra = (Array.isArray(z.extra) ? z.extra : []).map((p) => ({
      id: String(p.id ?? '').trim(),
      name: text(p.name, `zone ${domain} page "${p.id}"`),
      url: httpUrl(p.url, `zone ${domain} page "${p.id}"`),
      keyword: String(p.keyword ?? '').slice(0, 200),
    }))
    const zone: ZoneSetting = {
      id: String(z.id ?? '').trim(),
      domain,
      name: text(z.name, `zone ${domain}`),
      location: text(z.location, `zone ${domain} location`, false),
      country,
      probe: z.probe,
      exclude: (Array.isArray(z.exclude) ? z.exclude : []).filter((id) => appIds.has(id)),
      extra,
    }
    const pageIds = [...apps.filter((a) => !zone.exclude.includes(a.id)), ...extra]
    uniqueIds(pageIds, `zone ${domain} pages`)
    if (pageIds.length === 0) throw new HttpError(400, `zone ${domain}: has no pages to check`)
    if (pageIds.length > LIMITS.pagesPerZone) throw new HttpError(400, `zone ${domain}: at most ${LIMITS.pagesPerZone} pages`)
    return zone
  })
  uniqueIds(zones, 'zones')
  if (zones.length > LIMITS.zones) throw new HttpError(400, `at most ${LIMITS.zones} zones`)

  const keep = (value: string | null | undefined, stored: string) => (value === null || value === undefined ? stored : String(value).trim())
  const webhookUrl = keep(input.notify?.webhookUrl, current.notify.webhookUrl)
  const from = String(input.email?.from ?? '').trim()
  if (from && !/^(.+<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(from)) throw new HttpError(400, 'email sender: expected "Name <address@domain>"')

  const timeoutMs = int(input.probe?.timeoutMs, 'check timeout (ms)', 1000, 30000)
  return {
    site: {
      title: text(input.site?.title, 'site title'),
      url: httpUrl(input.site?.url, 'site URL', { allowEmpty: true }).replace(/\/+$/, ''),
      timezone: timeZone(input.site?.timezone),
      language: input.site?.language === 'zh' ? 'zh' : 'en',
    },
    apps,
    zones,
    notify: {
      webhookUrl: webhookUrl ? httpUrl(webhookUrl, 'team webhook') : '',
      webhookSecret: keep(input.notify?.webhookSecret, current.notify.webhookSecret),
      graceMinutes: int(input.notify?.graceMinutes, 'notify after (minutes)', 0, 60),
    },
    email: { resendApiKey: keep(input.email?.resendApiKey, current.email.resendApiKey), from },
    probe: { timeoutMs, degradedMs: int(input.probe?.degradedMs, 'slow threshold (ms)', 500, timeoutMs) },
  }
}

export async function saveSettings(env: Env, settings: Settings): Promise<void> {
  await env.DB.prepare(`INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(JSON.stringify(settings))
    .run()
  cache = { at: Date.now(), settings }
}
