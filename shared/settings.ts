// Settings edited in the admin console and stored in D1 (kv row "settings").
// Every field has a default in status.config.ts, so a fresh deployment works before anything is saved.
import type { DurableObjectLocationHint } from './types'

export interface Text {
  en: string
  zh: string
}

/** A page every zone serves; `{domain}` in the URL is replaced with the zone's domain. */
export interface AppTemplate {
  id: string
  name: Text
  url: string
}

/** A page checked in one zone only. */
export interface PageSetting {
  id: string
  name: Text
  url: string
  /** Text the page must contain; empty = any 2xx response is fine. */
  keyword: string
}

export interface ZoneSetting {
  /** History is keyed by zone id + page id: fixed once the zone is saved. */
  id: string
  domain: string
  name: Text
  location: Text
  /** ISO 3166 alpha-2 country code, or empty. */
  country: string
  /** Cloudflare region the checks for this zone run from. */
  probe: DurableObjectLocationHint
  /** Standard pages (AppTemplate ids) this zone does not serve. */
  exclude: string[]
  /** Pages only this zone serves. */
  extra: PageSetting[]
}

export interface Settings {
  site: {
    title: Text
    /** Public URL of the status page, for links in notifications. Empty = no links. */
    url: string
    /** IANA time zone that splits days for the history bars and daily uptime. */
    timezone: string
    /** Language for visitors whose browser language is not supported, and for team notifications. */
    language: 'en' | 'zh'
  }
  apps: AppTemplate[]
  zones: ZoneSetting[]
  notify: {
    /**
     * Team channel that receives every notification: a Slack, Discord, Feishu/Lark, DingTalk or
     * WeCom bot URL (detected from the host), or any URL accepting JSON. Empty = off.
     */
    webhookUrl: string
    /** Signing secret, for Feishu/Lark bots with signature verification on. */
    webhookSecret: string
    /** Minutes a page must stay down before a detected outage is announced. */
    graceMinutes: number
  }
  email: {
    /** Resend API key; with `from` set, visitors can subscribe by email. */
    resendApiKey: string
    from: string
  }
  probe: {
    timeoutMs: number
    /** A page that loads but slower than this counts as slow (degraded). */
    degradedMs: number
  }
}

/** Fields never sent back to the browser in full. */
export const SECRET_FIELDS = ['notify.webhookUrl', 'notify.webhookSecret', 'email.resendApiKey'] as const
export type SecretField = (typeof SECRET_FIELDS)[number]

/**
 * Settings as the admin console sees them: secret fields are blank, `secrets` says which are set
 * (with a masked hint). When saving, a secret field sent as null keeps the stored value.
 */
export interface AdminSettings {
  settings: Settings
  secrets: Record<SecretField, string | null>
  /** Probe regions with labels, for the zone editor. */
  regions: { id: DurableObjectLocationHint; label: Text }[]
}

export type SettingsInput = Omit<Settings, 'notify' | 'email'> & {
  notify: Omit<Settings['notify'], 'webhookUrl' | 'webhookSecret'> & { webhookUrl: string | null; webhookSecret: string | null }
  email: Omit<Settings['email'], 'resendApiKey'> & { resendApiKey: string | null }
}

export const REGIONS: AdminSettings['regions'] = [
  { id: 'apac', label: { en: 'Asia-Pacific', zh: '亚太' } },
  { id: 'wnam', label: { en: 'Western North America', zh: '北美西部' } },
  { id: 'enam', label: { en: 'Eastern North America', zh: '北美东部' } },
  { id: 'sam', label: { en: 'South America', zh: '南美' } },
  { id: 'weur', label: { en: 'Western Europe', zh: '西欧' } },
  { id: 'eeur', label: { en: 'Eastern Europe', zh: '东欧' } },
  { id: 'oc', label: { en: 'Oceania', zh: '大洋洲' } },
  { id: 'me', label: { en: 'Middle East', zh: '中东' } },
  { id: 'afr', label: { en: 'Africa', zh: '非洲' } },
]

export const fillDomain = (template: string, domain: string) => template.replaceAll('{domain}', domain)
